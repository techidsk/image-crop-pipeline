import json
import base64
import os
import subprocess
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from .cropping import make_crop
from .pose import Pose, classify_pose_view, make_pose_provider
from .batch_store import append_batch_job, load_batch_jobs
from .preset_store import load_presets, save_presets
from .scene_store import load_scenes, save_scenes
from .schemas import (
    BatchJob,
    BatchJobImage,
    BatchJobResponse,
    BatchProcessResponse,
    CropResult,
    CropPreset,
    CropScene,
    PoseAnalysis,
    PoseAnalysisBatchResponse,
    ProcessResponse,
    TrainingSample,
    TrainingSampleBatchResponse,
)
from .training_store import (
    append_training_samples,
    find_sample_image_path,
    load_training_samples,
    make_sample_id,
    resolve_image_path,
    safe_id,
    sample_image_url,
    save_training_samples,
    save_upload_image,
)

app = FastAPI(title="OpenPose Crop Pipeline")
POSE_DETECT_MAX_SIDE = int(os.getenv("POSE_DETECT_MAX_SIDE", "1280"))
pose_providers = {"heuristic": make_pose_provider("heuristic")}
try:
    pose_providers["rtmw"] = make_pose_provider("rtmw")
except RuntimeError:
    pass

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def resolve_pose_provider_name(name: str | None = None) -> str:
    provider_name = (name or "rtmw").lower()
    if provider_name == "rtmw" and provider_name not in pose_providers:
        provider_name = "heuristic"
    if provider_name not in pose_providers:
        raise HTTPException(status_code=400, detail=f"Unsupported pose provider: {provider_name}")
    return provider_name


def get_pose_provider(name: str | None = None):
    return pose_providers[resolve_pose_provider_name(name)]


def pose_confidence(keypoints) -> float:
    points = [point for point in keypoints if point.confidence > 0.05]
    if not points:
        return 0.0
    return sorted(point.confidence for point in points)[len(points) // 2]


def safe_filename(value: str) -> str:
    stem = Path(value or "image").stem
    safe = "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in stem)
    return safe or "image"


def ndjson_event(payload: dict[str, object]) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


def detect_pose(provider_name: str, source_image: Image.Image) -> Pose:
    provider = pose_providers[provider_name]
    max_side = max(source_image.width, source_image.height)
    if max_side <= POSE_DETECT_MAX_SIDE:
        return provider.detect(source_image)

    scale = POSE_DETECT_MAX_SIDE / max_side
    detect_size = (
        max(1, round(source_image.width * scale)),
        max(1, round(source_image.height * scale)),
    )
    detect_image = source_image.resize(detect_size, Image.Resampling.BILINEAR)
    pose = provider.detect(detect_image)
    scale_x = source_image.width / detect_image.width
    scale_y = source_image.height / detect_image.height
    return Pose(
        keypoints=[
            point.model_copy(
                update={
                    "x": point.x * scale_x,
                    "y": point.y * scale_y,
                }
            )
            for point in pose.keypoints
        ]
    )


@app.get("/api/pose-providers")
def get_pose_providers() -> dict[str, object]:
    return {
        "default": "rtmw" if "rtmw" in pose_providers else "heuristic",
        "providers": [
            *([{"id": "rtmw", "name": "RTMW-l ONNX"}] if "rtmw" in pose_providers else []),
            {"id": "heuristic", "name": "旧方案 / Heuristic"},
        ],
    }


@app.get("/api/presets", response_model=list[CropPreset])
def get_presets() -> list[CropPreset]:
    return load_presets()


@app.put("/api/presets", response_model=list[CropPreset])
def put_presets(presets: list[CropPreset]) -> list[CropPreset]:
    return save_presets(presets)


@app.get("/api/scenes", response_model=list[CropScene])
def get_scenes() -> list[CropScene]:
    return load_scenes()


@app.put("/api/scenes", response_model=list[CropScene])
def put_scenes(scenes: list[CropScene]) -> list[CropScene]:
    return save_scenes(scenes)


@app.get("/api/batch-jobs", response_model=list[BatchJob])
def get_batch_jobs() -> list[BatchJob]:
    return load_batch_jobs()


@app.post("/api/batch-jobs/{job_id}/open-output")
def open_batch_job_output(job_id: str) -> dict[str, str]:
    job = next((item for item in load_batch_jobs() if item.id == job_id), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Batch job not found")
    output_path = Path(job.outputDir)
    if not output_path.exists() or not output_path.is_dir():
        raise HTTPException(status_code=404, detail="Output directory not found")
    try:
        if sys.platform.startswith("win"):
            os.startfile(output_path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(output_path)])
        else:
            subprocess.Popen(["xdg-open", str(output_path)])
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Cannot open output directory: {exc}") from exc
    return {"status": "ok", "path": str(output_path)}


def parse_presets(raw_presets: str) -> list[CropPreset]:
    try:
        return [CropPreset.model_validate(item) for item in json.loads(raw_presets)]
    except (json.JSONDecodeError, TypeError, ValidationError) as exc:
        raise HTTPException(status_code=400, detail="Invalid crop presets") from exc


def presets_for_view(crop_presets: list[CropPreset], view_angle: str) -> list[CropPreset]:
    return [
        preset
        for preset in crop_presets
        if not preset.viewAngles or view_angle in preset.viewAngles
    ]


async def process_upload(
    image: UploadFile,
    crop_presets: list[CropPreset],
    provider_name: str | None = None,
) -> ProcessResponse:
    try:
        raw = await image.read()
        source_image = Image.open(BytesIO(raw)).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Unsupported image file") from exc

    actual_provider = resolve_pose_provider_name(provider_name)
    pose = detect_pose(actual_provider, source_image)
    view_angle = classify_pose_view(pose)
    matched_presets = presets_for_view(crop_presets, view_angle)
    try:
        crops = [make_crop(source_image, pose, preset) for preset in matched_presets]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ProcessResponse(
        filename=image.filename,
        source={"width": source_image.width, "height": source_image.height},
        viewAngle=view_angle,
        keypoints=pose.keypoints,
        crops=crops,
    )


async def process_upload_to_output_dir(
    image: UploadFile,
    crop_presets: list[CropPreset],
    output_dir: Path,
    provider_name: str | None = None,
) -> ProcessResponse:
    response = await process_upload(image, crop_presets, provider_name)
    source_name = safe_filename(response.filename or image.filename or "image")
    next_crops: list[CropResult] = []
    for crop in response.crops:
        preset_dir = output_dir / safe_filename(crop.presetId)
        preset_dir.mkdir(parents=True, exist_ok=True)
        output_path = preset_dir / f"{source_name}_{safe_filename(crop.presetId)}.png"
        output_path.write_bytes(base64.b64decode(crop.image))
        next_crops.append(crop.model_copy(update={"outputPath": str(output_path)}))
    return response.model_copy(update={"crops": next_crops})


async def analyze_upload(image: UploadFile, provider_name: str | None = None) -> PoseAnalysis:
    try:
        raw = await image.read()
        source_image = Image.open(BytesIO(raw)).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Unsupported image file") from exc

    actual_provider = resolve_pose_provider_name(provider_name)
    pose = detect_pose(actual_provider, source_image)
    view_angle = classify_pose_view(pose)
    return PoseAnalysis(
        filename=image.filename,
        source={"width": source_image.width, "height": source_image.height},
        viewAngle=view_angle,
        keypoints=pose.keypoints,
    )


async def create_training_sample(
    preset_id: str,
    image: UploadFile,
    provider_name: str | None = None,
) -> TrainingSample:
    try:
        raw = await image.read()
        source_image = Image.open(BytesIO(raw)).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Unsupported image file") from exc

    sample_id = make_sample_id()
    suffix = await save_upload_image(preset_id, sample_id, image, raw)
    actual_provider = resolve_pose_provider_name(provider_name)
    pose = detect_pose(actual_provider, source_image)
    view_angle = classify_pose_view(pose)
    confidence = pose_confidence(pose.keypoints)
    return TrainingSample(
        id=sample_id,
        filename=image.filename or "image",
        imageUrl=sample_image_url(preset_id, sample_id, suffix),
        source={"width": source_image.width, "height": source_image.height},
        keypoints=pose.keypoints,
        viewAngle=view_angle,
        poseProvider=actual_provider,
        crop={
            "left": 0,
            "top": 0,
            "width": source_image.width,
            "height": source_image.height,
        },
        confidence=confidence,
        confirmed=False,
        set="train",
    )


def reanalyze_training_samples(
    preset_id: str,
    provider_name: str | None = None,
    only_unknown: bool = True,
) -> list[TrainingSample]:
    actual_provider = resolve_pose_provider_name(provider_name)
    samples = load_training_samples(preset_id)
    next_samples: list[TrainingSample] = []
    for sample in samples:
        if only_unknown and sample.poseProvider != "unknown":
            next_samples.append(sample)
            continue
        image_path = find_sample_image_path(preset_id, sample.id)
        if image_path is None:
            next_samples.append(sample)
            continue
        try:
            source_image = Image.open(image_path).convert("RGB")
        except (UnidentifiedImageError, OSError):
            next_samples.append(sample)
            continue
        pose = detect_pose(actual_provider, source_image)
        view_angle = classify_pose_view(pose)
        next_samples.append(
            sample.model_copy(
                update={
                    "source": {"width": source_image.width, "height": source_image.height},
                    "keypoints": pose.keypoints,
                    "viewAngle": view_angle,
                    "poseProvider": actual_provider,
                    "confidence": pose_confidence(pose.keypoints),
                }
            )
        )
    return save_training_samples(preset_id, next_samples)


@app.post("/api/process", response_model=ProcessResponse)
async def process_image(
    image: UploadFile = File(...),
    presets: str = Form(...),
    pose_provider: str = Form("rtmw"),
) -> ProcessResponse:
    return await process_upload(image, parse_presets(presets), pose_provider)


@app.post("/api/process-compare")
async def process_image_compare(
    image: UploadFile = File(...),
    presets: str = Form(...),
) -> dict[str, ProcessResponse]:
    raw = await image.read()
    crop_presets = parse_presets(presets)
    results: dict[str, ProcessResponse] = {}
    for provider_name in pose_providers:
        cloned_upload = UploadFile(file=BytesIO(raw), filename=image.filename)
        results[provider_name] = await process_upload(cloned_upload, crop_presets, provider_name)
    return results


@app.post("/api/process-batch", response_model=BatchProcessResponse)
async def process_batch(
    images: list[UploadFile] = File(...),
    presets: str = Form(...),
    pose_provider: str = Form("rtmw"),
) -> BatchProcessResponse:
    crop_presets = parse_presets(presets)
    return BatchProcessResponse(
        images=[await process_upload(image, crop_presets, pose_provider) for image in images]
    )


@app.post("/api/batch-jobs/run", response_model=BatchJobResponse)
async def run_batch_job(
    images: list[UploadFile] = File(...),
    scene_id: str = Form(...),
    output_dir: str = Form(...),
    pose_provider: str = Form("rtmw"),
) -> BatchJobResponse:
    job_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:6]
    created_at = datetime.now().isoformat(timespec="seconds")
    scenes = load_scenes()
    scene = next((item for item in scenes if item.id == scene_id), None)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    actual_provider = resolve_pose_provider_name(pose_provider)
    presets_by_id = {preset.id: preset for preset in load_presets()}
    bound_ids = [
        binding.presetId
        for binding in scene.presets
        if binding.enabled
    ] or scene.presetIds
    crop_presets = [presets_by_id[preset_id] for preset_id in bound_ids if preset_id in presets_by_id]
    if not crop_presets:
        job = append_batch_job(
            BatchJob(
                id=job_id,
                sceneId=scene.id,
                sceneName=scene.name,
                poseProvider=actual_provider,
                outputDir=output_dir,
                imageCount=len(images),
                outputCount=0,
                status="failed",
                createdAt=created_at,
                images=[
                    BatchJobImage(
                        filename=image.filename or "image",
                        outputs=0,
                        error="场景没有可用预设，请先在场景管理中绑定预设。",
                    )
                    for image in images
                ],
            )
        )
        return BatchJobResponse(job=job, images=[])

    target_dir = Path(output_dir).expanduser()
    if not target_dir.is_absolute():
        target_dir = Path.cwd() / target_dir
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        job = append_batch_job(
            BatchJob(
                id=job_id,
                sceneId=scene.id,
                sceneName=scene.name,
                poseProvider=actual_provider,
                outputDir=str(target_dir),
                imageCount=len(images),
                outputCount=0,
                status="failed",
                createdAt=created_at,
                images=[
                    BatchJobImage(
                        filename=image.filename or "image",
                        outputs=0,
                        error=f"输出目录不可写：{exc}",
                    )
                    for image in images
                ],
            )
        )
        return BatchJobResponse(job=job, images=[])

    job_dir = target_dir / job_id
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        job = append_batch_job(
            BatchJob(
                id=job_id,
                sceneId=scene.id,
                sceneName=scene.name,
                poseProvider=actual_provider,
                outputDir=str(job_dir),
                imageCount=len(images),
                outputCount=0,
                status="failed",
                createdAt=created_at,
                images=[
                    BatchJobImage(
                        filename=image.filename or "image",
                        outputs=0,
                        error=f"任务目录不可写：{exc}",
                    )
                    for image in images
                ],
            )
        )
        return BatchJobResponse(job=job, images=[])

    results: list[ProcessResponse] = []
    image_reports: list[BatchJobImage] = []
    for image in images:
        try:
            result = await process_upload_to_output_dir(image, crop_presets, job_dir, actual_provider)
            results.append(result)
            image_reports.append(
                BatchJobImage(filename=image.filename or "image", outputs=len(result.crops))
            )
        except HTTPException as exc:
            image_reports.append(
                BatchJobImage(filename=image.filename or "image", outputs=0, error=str(exc.detail))
            )

    output_count = sum(len(result.crops) for result in results)
    job = append_batch_job(
        BatchJob(
            id=job_id,
            sceneId=scene.id,
            sceneName=scene.name,
            poseProvider=actual_provider,
            outputDir=str(job_dir),
            imageCount=len(images),
            outputCount=output_count,
            status="completed" if output_count > 0 else "failed",
            createdAt=created_at,
            images=image_reports,
        )
    )
    return BatchJobResponse(job=job, images=results)


@app.post("/api/batch-jobs/run-stream")
async def run_batch_job_stream(
    images: list[UploadFile] = File(...),
    scene_id: str = Form(...),
    output_dir: str = Form(...),
    pose_provider: str = Form("rtmw"),
) -> StreamingResponse:
    async def events():
        job_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:6]
        created_at = datetime.now().isoformat(timespec="seconds")
        total = len(images)
        try:
            actual_provider = resolve_pose_provider_name(pose_provider)
            scenes = load_scenes()
            scene = next((item for item in scenes if item.id == scene_id), None)
            if scene is None:
                yield ndjson_event({"type": "error", "message": "Scene not found"})
                return

            presets_by_id = {preset.id: preset for preset in load_presets()}
            bound_ids = [
                binding.presetId
                for binding in scene.presets
                if binding.enabled
            ] or scene.presetIds
            crop_presets = [presets_by_id[preset_id] for preset_id in bound_ids if preset_id in presets_by_id]
            if not crop_presets:
                job = append_batch_job(
                    BatchJob(
                        id=job_id,
                        sceneId=scene.id,
                        sceneName=scene.name,
                        poseProvider=actual_provider,
                        outputDir=output_dir,
                        imageCount=total,
                        outputCount=0,
                        status="failed",
                        createdAt=created_at,
                        images=[
                            BatchJobImage(
                                filename=image.filename or "image",
                                outputs=0,
                                error="场景没有可用预设，请先在场景管理中绑定预设。",
                            )
                            for image in images
                        ],
                    )
                )
                yield ndjson_event({"type": "final", "job": job.model_dump(mode="json"), "images": []})
                return

            target_dir = Path(output_dir).expanduser()
            if not target_dir.is_absolute():
                target_dir = Path.cwd() / target_dir
            try:
                target_dir.mkdir(parents=True, exist_ok=True)
                job_dir = target_dir / job_id
                job_dir.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                job = append_batch_job(
                    BatchJob(
                        id=job_id,
                        sceneId=scene.id,
                        sceneName=scene.name,
                        poseProvider=actual_provider,
                        outputDir=str(target_dir),
                        imageCount=total,
                        outputCount=0,
                        status="failed",
                        createdAt=created_at,
                        images=[
                            BatchJobImage(
                                filename=image.filename or "image",
                                outputs=0,
                                error=f"输出目录不可写：{exc}",
                            )
                            for image in images
                        ],
                    )
                )
                yield ndjson_event({"type": "final", "job": job.model_dump(mode="json"), "images": []})
                return

            yield ndjson_event(
                {
                    "type": "start",
                    "jobId": job_id,
                    "total": total,
                    "presetCount": len(crop_presets),
                    "outputDir": str(job_dir),
                }
            )

            results: list[ProcessResponse] = []
            image_reports: list[BatchJobImage] = []
            for index, image in enumerate(images, start=1):
                filename = image.filename or "image"
                yield ndjson_event(
                    {
                        "type": "active",
                        "jobId": job_id,
                        "completed": index - 1,
                        "total": total,
                        "filename": filename,
                    }
                )
                try:
                    result = await process_upload_to_output_dir(image, crop_presets, job_dir, actual_provider)
                    results.append(result)
                    report = BatchJobImage(filename=filename, outputs=len(result.crops))
                    image_reports.append(report)
                    yield ndjson_event(
                        {
                            "type": "progress",
                            "jobId": job_id,
                            "completed": index,
                            "total": total,
                            "filename": filename,
                            "outputs": len(result.crops),
                            "result": result.model_dump(mode="json"),
                        }
                    )
                except HTTPException as exc:
                    report = BatchJobImage(filename=filename, outputs=0, error=str(exc.detail))
                    image_reports.append(report)
                    yield ndjson_event(
                        {
                            "type": "progress",
                            "jobId": job_id,
                            "completed": index,
                            "total": total,
                            "filename": filename,
                            "outputs": 0,
                            "error": str(exc.detail),
                        }
                    )

            output_count = sum(len(result.crops) for result in results)
            job = append_batch_job(
                BatchJob(
                    id=job_id,
                    sceneId=scene.id,
                    sceneName=scene.name,
                    poseProvider=actual_provider,
                    outputDir=str(job_dir),
                    imageCount=total,
                    outputCount=output_count,
                    status="completed" if output_count > 0 else "failed",
                    createdAt=created_at,
                    images=image_reports,
                )
            )
            yield ndjson_event(
                {
                    "type": "final",
                    "job": job.model_dump(mode="json"),
                    "images": [result.model_dump(mode="json") for result in results],
                }
            )
        except Exception as exc:
            yield ndjson_event({"type": "error", "message": str(exc)})

    return StreamingResponse(events(), media_type="application/x-ndjson")


@app.post("/api/analyze-poses", response_model=PoseAnalysisBatchResponse)
async def analyze_poses(
    images: list[UploadFile] = File(...),
    pose_provider: str = Form("rtmw"),
) -> PoseAnalysisBatchResponse:
    return PoseAnalysisBatchResponse(images=[await analyze_upload(image, pose_provider) for image in images])


@app.get("/api/presets/{preset_id}/training-samples", response_model=TrainingSampleBatchResponse)
def get_training_samples(preset_id: str) -> TrainingSampleBatchResponse:
    return TrainingSampleBatchResponse(samples=load_training_samples(preset_id))


@app.put("/api/presets/{preset_id}/training-samples", response_model=TrainingSampleBatchResponse)
def put_training_samples(
    preset_id: str,
    samples: list[TrainingSample],
) -> TrainingSampleBatchResponse:
    return TrainingSampleBatchResponse(samples=save_training_samples(preset_id, samples))


@app.post("/api/presets/{preset_id}/training-samples", response_model=TrainingSampleBatchResponse)
async def post_training_samples(
    preset_id: str,
    images: list[UploadFile] = File(...),
    pose_provider: str = Form("rtmw"),
) -> TrainingSampleBatchResponse:
    samples = [await create_training_sample(preset_id, image, pose_provider) for image in images]
    return TrainingSampleBatchResponse(samples=append_training_samples(preset_id, samples))


@app.post("/api/presets/{preset_id}/training-samples/reanalyze", response_model=TrainingSampleBatchResponse)
def post_reanalyze_training_samples(
    preset_id: str,
    pose_provider: str = Form("rtmw"),
    only_unknown: bool = Form(True),
) -> TrainingSampleBatchResponse:
    samples = reanalyze_training_samples(preset_id, pose_provider, only_unknown)
    return TrainingSampleBatchResponse(samples=samples)


@app.get("/api/presets/{preset_id}/training-samples/{sample_id}/image{suffix}")
def get_training_sample_image(preset_id: str, sample_id: str, suffix: str) -> FileResponse:
    path = resolve_image_path(preset_id, sample_id, suffix)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Training sample image not found")
    return FileResponse(path)
