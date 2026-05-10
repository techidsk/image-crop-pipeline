import json
from io import BytesIO
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from .cropping import make_crop
from .pose import make_pose_provider
from .preset_store import load_presets, save_presets
from .schemas import (
    BatchProcessResponse,
    CropPreset,
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


def parse_presets(raw_presets: str) -> list[CropPreset]:
    try:
        return [CropPreset.model_validate(item) for item in json.loads(raw_presets)]
    except (json.JSONDecodeError, TypeError, ValidationError) as exc:
        raise HTTPException(status_code=400, detail="Invalid crop presets") from exc


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
    pose = pose_providers[actual_provider].detect(source_image)
    try:
        crops = [make_crop(source_image, pose, preset) for preset in crop_presets]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ProcessResponse(
        filename=image.filename,
        source={"width": source_image.width, "height": source_image.height},
        keypoints=pose.keypoints,
        crops=crops,
    )


async def analyze_upload(image: UploadFile, provider_name: str | None = None) -> PoseAnalysis:
    try:
        raw = await image.read()
        source_image = Image.open(BytesIO(raw)).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Unsupported image file") from exc

    pose = get_pose_provider(provider_name).detect(source_image)
    return PoseAnalysis(
        filename=image.filename,
        source={"width": source_image.width, "height": source_image.height},
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
    pose = pose_providers[actual_provider].detect(source_image)
    confidence = pose_confidence(pose.keypoints)
    return TrainingSample(
        id=sample_id,
        filename=image.filename or "image",
        imageUrl=sample_image_url(preset_id, sample_id, suffix),
        source={"width": source_image.width, "height": source_image.height},
        keypoints=pose.keypoints,
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
        pose = pose_providers[actual_provider].detect(source_image)
        next_samples.append(
            sample.model_copy(
                update={
                    "source": {"width": source_image.width, "height": source_image.height},
                    "keypoints": pose.keypoints,
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
