import base64
import hashlib
import importlib.util
import json
import logging
import os
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime
from io import BytesIO
from logging.handlers import RotatingFileHandler
from pathlib import Path, PurePosixPath
from uuid import uuid4
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError
from starlette.background import BackgroundTask

from .cropping import make_crop
from .image_utils import open_image_as_srgb
from .model_manager import ensure_model_available
from .pose import Pose, make_pose_provider
from .batch_store import (
    append_batch_job,
    get_batch_job,
    load_batch_jobs,
    update_batch_job_image_review_status,
    update_batch_job_review_status,
)
from .preset_store import load_presets, save_presets
from .scene_store import load_scenes, save_scenes
from .storage_provider import get_storage_status, sync_now
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
    RegenerateViewUpdate,
    ReviewStatusUpdate,
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
from .view_classifier import classify_view, classify_view_with_trace

app = FastAPI(title="OpenPose Crop Pipeline")
logger = logging.getLogger(__name__)
POSE_DETECT_MAX_SIDE = int(os.getenv("POSE_DETECT_MAX_SIDE", "1280"))
ANALYZE_BODY_KEYPOINTS = {
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "neck",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
}


def configure_file_logging() -> None:
    log_file = Path(
        os.getenv(
            "BACKEND_LOG_FILE",
            Path(__file__).resolve().parents[1] / "data" / "logs" / "backend.log",
        )
    )
    log_file.parent.mkdir(parents=True, exist_ok=True)
    logger.setLevel(logging.INFO)
    if any(
        isinstance(handler, RotatingFileHandler)
        and Path(handler.baseFilename) == log_file
        for handler in logger.handlers
    ):
        return
    handler = RotatingFileHandler(
        log_file,
        maxBytes=int(os.getenv("BACKEND_LOG_MAX_BYTES", "5242880")),
        backupCount=int(os.getenv("BACKEND_LOG_BACKUP_COUNT", "3")),
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)


configure_file_logging()


def _open_output_dir_enabled() -> bool:
    raw = os.getenv("ENABLE_OPEN_OUTPUT_DIR", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return sys.platform.startswith("win")


OPEN_OUTPUT_DIR_ENABLED = _open_output_dir_enabled()
ensure_model_available()
try:
    sync_now(force=False)
except Exception as exc:
    print(f"启动时云端同步检查失败: {exc}", flush=True)
pose_providers = {"heuristic": make_pose_provider("heuristic")}
try:
    pose_providers["rtmw"] = make_pose_provider("rtmw")
except RuntimeError:
    pass

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:7171",
        "http://localhost:7171",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def dependency_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def path_status(value: str | None) -> dict[str, object]:
    if not value:
        return {"path": "", "exists": False, "size": 0}
    path = Path(value).expanduser()
    exists = path.exists()
    return {
        "path": str(path),
        "exists": exists,
        "size": path.stat().st_size if exists and path.is_file() else 0,
    }


@app.get("/api/model-health")
def model_health() -> dict[str, object]:
    rtmw_path = Path(os.getenv("RTMW_ONNX_PATH", "models/rtmw-l-384x288.onnx")).expanduser()
    paddle_dir = Path(
        os.getenv(
            "PADDLE_PERSON_ATTRIBUTE_DIR",
            Path.home() / ".paddleclas" / "inference_model" / "PULC" / "person_attribute",
        )
    ).expanduser()
    paddle_model = paddle_dir / "inference.pdmodel"
    paddle_params = paddle_dir / "inference.pdiparams"
    view_providers = [
        value.strip()
        for value in os.getenv("VIEW_PROVIDER", "densepose,paddle").lower().replace(";", ",").split(",")
        if value.strip()
    ]
    densepose_config = os.getenv("DENSEPOSE_CONFIG", "")
    densepose_weights = os.getenv("DENSEPOSE_WEIGHTS", "")

    return {
        "pose": {
            "requestedDefault": os.getenv("POSE_PROVIDER", "rtmw").lower(),
            "activeDefault": "rtmw" if "rtmw" in pose_providers else "heuristic",
            "availableProviders": sorted(pose_providers.keys()),
            "rtmw": {
                "loaded": "rtmw" in pose_providers,
                "configuredPath": str(rtmw_path),
                "modelExists": rtmw_path.exists(),
                "modelSize": rtmw_path.stat().st_size if rtmw_path.exists() and rtmw_path.is_file() else 0,
                "inputWidth": int(os.getenv("RTMW_INPUT_WIDTH", "288")),
                "inputHeight": int(os.getenv("RTMW_INPUT_HEIGHT", "384")),
                "autoDownload": os.getenv("MODEL_AUTO_DOWNLOAD", "false"),
                "downloadRequired": os.getenv("MODEL_DOWNLOAD_REQUIRED", "false"),
            },
        },
        "view": {
            "providerOrder": view_providers,
            "paddle": {
                "enabled": bool({"paddle", "paddle_person_attribute"} & set(view_providers)),
                "dependencyAvailable": dependency_available("paddle"),
                "modelDir": str(paddle_dir),
                "modelExists": paddle_model.exists(),
                "paramsExists": paddle_params.exists(),
                "ready": dependency_available("paddle") and paddle_model.exists() and paddle_params.exists(),
                "confirmConfidence": float(os.getenv("PADDLE_DIRECTION_CONFIRM_CONFIDENCE", "0.85")),
            },
            "densepose": {
                "enabled": bool({"densepose", "dense_pose"} & set(view_providers)),
                "config": path_status(densepose_config),
                "weights": path_status(densepose_weights),
                "denseposeAvailable": dependency_available("densepose"),
                "detectron2Available": dependency_available("detectron2"),
                "ready": bool(densepose_config)
                and bool(densepose_weights)
                and Path(densepose_config).expanduser().exists()
                and Path(densepose_weights).expanduser().exists()
                and dependency_available("densepose")
                and dependency_available("detectron2"),
            },
        },
        "diagnostics": {
            "logFile": os.getenv(
                "BACKEND_LOG_FILE",
                str(Path(__file__).resolve().parents[1] / "data" / "logs" / "backend.log"),
            ),
            "analyzeTraceMarker": "analyze_poses_view_trace",
        },
    }


@app.get("/api/server-config")
def server_config() -> dict[str, object]:
    return {"features": {"openOutputDir": OPEN_OUTPUT_DIR_ENABLED}}


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


def response_keypoints(pose: Pose, scope: str = "full"):
    normalized_scope = (scope or "full").strip().lower()
    if normalized_scope in {"body", "body_only", "compact"}:
        return [point for point in pose.keypoints if point.name in ANALYZE_BODY_KEYPOINTS]
    return pose.keypoints


def safe_filename(value: str) -> str:
    stem = Path(value or "image").stem
    safe = "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in stem)
    return safe or "image"


ORIGINALS_DIRNAME = "_originals"
OUTPUT_LAYOUT_BY_PRESET = "by_preset"
OUTPUT_LAYOUT_SINGLE_FOLDER = "single_folder"


def normalize_relative_path(value: str | None, fallback: str = "image") -> str:
    raw = (value or fallback or "image").replace("\\", "/")
    path = PurePosixPath(raw)
    parts = [part for part in path.parts if part not in ("", ".", "..")]
    if not parts:
        parts = [fallback or "image"]
    return "/".join(parts)


def safe_path_part(value: str, fallback: str = "part") -> str:
    invalid = set('<>:"/\\|?*')
    safe = "".join("_" if char in invalid or ord(char) < 32 else char for char in value)
    safe = safe.rstrip(" .")
    return safe or fallback


def source_folder_label(relative_path: str) -> str:
    parts = PurePosixPath(normalize_relative_path(relative_path)).parts
    if len(parts) < 2:
        return "散图"
    return "/".join(parts[:-1])


def output_source_dir_parts(relative_path: str) -> list[str]:
    parts = PurePosixPath(normalize_relative_path(relative_path)).parts
    return [safe_path_part(part, "folder") for part in parts[:-1]]


def output_source_stem(relative_path: str) -> str:
    name = PurePosixPath(normalize_relative_path(relative_path)).name or "image"
    return safe_path_part(PurePosixPath(name).stem or "image", "image")


def output_crop_filename(relative_path: str, preset_id: str) -> str:
    return f"{output_source_stem(relative_path)}_{safe_filename(preset_id)}.png"


def resolve_output_layout(value: str | None) -> str:
    layout = (value or OUTPUT_LAYOUT_BY_PRESET).strip().lower()
    if layout not in (OUTPUT_LAYOUT_BY_PRESET, OUTPUT_LAYOUT_SINGLE_FOLDER):
        raise HTTPException(status_code=400, detail="Unsupported output layout")
    return layout


def archive_originals_dir(job_dir: Path) -> Path:
    return job_dir / ORIGINALS_DIRNAME


def archive_originals(job_dir: Path, uploaded: list[tuple[str, bytes]]) -> None:
    target = archive_originals_dir(job_dir)
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    for filename, data in uploaded:
        relative = normalize_relative_path(filename)
        safe_parts = [safe_path_part(part, "folder") for part in PurePosixPath(relative).parts[:-1]]
        safe_name = safe_path_part(PurePosixPath(relative).name or "image", "image")
        try:
            output_path = target.joinpath(*safe_parts, safe_name)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(data)
        except OSError:
            continue


def load_archived_originals(job: BatchJob) -> list[tuple[str, bytes]]:
    originals_dir = archive_originals_dir(Path(job.outputDir).expanduser())
    if not originals_dir.exists() or not originals_dir.is_dir():
        return []
    items: list[tuple[str, bytes]] = []
    for image in job.images:
        relative = normalize_relative_path(image.filename)
        safe_parts = [safe_path_part(part, "folder") for part in PurePosixPath(relative).parts[:-1]]
        safe_name = safe_path_part(PurePosixPath(relative).name or "image", "image")
        candidate = originals_dir.joinpath(*safe_parts, safe_name)
        if not candidate.exists() or not candidate.is_file():
            continue
        try:
            items.append((image.filename or candidate.name, candidate.read_bytes()))
        except OSError:
            continue
    return items


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


@app.get("/api/storage/status")
def storage_status() -> dict:
    return get_storage_status()


@app.post("/api/storage/sync")
def storage_sync() -> dict:
    return sync_now(force=True)


@app.get("/api/batch-jobs", response_model=list[BatchJob])
def get_batch_jobs() -> list[BatchJob]:
    return load_batch_jobs()


@app.get("/api/batch-jobs/{job_id}", response_model=BatchJobResponse)
def get_batch_job_detail(job_id: str) -> BatchJobResponse:
    job = get_batch_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Batch job not found")
    return BatchJobResponse(job=job, images=load_batch_job_results(job))


@app.post("/api/batch-jobs/{job_id}/open-output")
def open_batch_job_output(job_id: str) -> dict[str, str]:
    if not OPEN_OUTPUT_DIR_ENABLED:
        raise HTTPException(
            status_code=410,
            detail="服务端未启用「打开输出目录」功能（部署在远程服务器时打开本地目录无意义）。",
        )
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


@app.get("/api/batch-jobs/{job_id}/download")
def download_batch_job_output(job_id: str) -> FileResponse:
    job = get_batch_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Batch job not found")
    output_path = Path(job.outputDir).expanduser()
    if not output_path.exists() or not output_path.is_dir():
        raise HTTPException(status_code=404, detail="Output directory not found")

    archive = tempfile.NamedTemporaryFile(prefix=f"image-crop-{job_id}-", suffix=".zip", delete=False)
    archive_path = Path(archive.name)
    archive.close()
    try:
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
            for path in sorted(item for item in output_path.rglob("*") if item.is_file()):
                relative = path.relative_to(output_path)
                if ORIGINALS_DIRNAME in relative.parts:
                    continue
                zip_file.write(path, relative)
    except OSError as exc:
        archive_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Cannot create output archive: {exc}") from exc

    return FileResponse(
        archive_path,
        media_type="application/zip",
        filename=f"image-crop-{job_id}.zip",
        background=BackgroundTask(lambda: archive_path.unlink(missing_ok=True)),
    )


@app.get("/api/batch-jobs/{job_id}/files/{relative_path:path}")
def serve_batch_job_file(job_id: str, relative_path: str) -> FileResponse:
    job = get_batch_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Batch job not found")
    job_root = Path(job.outputDir).expanduser().resolve()
    target = (job_root / relative_path).resolve()
    try:
        rel = target.relative_to(job_root)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Path outside job directory") from exc
    if ORIGINALS_DIRNAME in rel.parts:
        raise HTTPException(status_code=403, detail="Originals are private")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        target,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.patch("/api/batch-jobs/{job_id}/review", response_model=BatchJob)
def patch_batch_job_review(job_id: str, update: ReviewStatusUpdate) -> BatchJob:
    job = update_batch_job_review_status(job_id, update.reviewStatus)
    if job is None:
        raise HTTPException(status_code=404, detail="Batch job not found")
    return job


@app.patch("/api/batch-jobs/{job_id}/images/{filename:path}/review", response_model=BatchJob)
def patch_batch_job_image_review(
    job_id: str,
    filename: str,
    update: ReviewStatusUpdate,
) -> BatchJob:
    try:
        job = update_batch_job_image_review_status(job_id, filename, update.reviewStatus)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Batch job image not found") from exc
    if job is None:
        raise HTTPException(status_code=404, detail="Batch job not found")
    return job


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
    view_angle_override: str | None = None,
) -> ProcessResponse:
    try:
        raw = await image.read()
        source_image = open_image_as_srgb(BytesIO(raw))
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Unsupported image file") from exc

    actual_provider = resolve_pose_provider_name(provider_name)
    pose = detect_pose(actual_provider, source_image)
    view_classification = classify_view(source_image, pose)
    view_angle = view_angle_override or view_classification.angle
    matched_presets = presets_for_view(crop_presets, view_angle)
    try:
        crops = [make_crop(source_image, pose, preset) for preset in matched_presets]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ProcessResponse(
        filename=image.filename,
        source={"width": source_image.width, "height": source_image.height},
        viewAngle=view_angle,
        poseProvider=actual_provider,
        viewProvider="manual_override" if view_angle_override else view_classification.provider,
        viewConfidence=None if view_angle_override else view_classification.confidence,
        keypoints=pose.keypoints,
        crops=crops,
    )


async def process_upload_to_output_dir(
    image: UploadFile,
    crop_presets: list[CropPreset],
    output_dir: Path,
    job_id: str,
    provider_name: str | None = None,
    source_path: str | None = None,
    output_layout: str = OUTPUT_LAYOUT_BY_PRESET,
    view_angle_override: str | None = None,
) -> ProcessResponse:
    response = await process_upload(image, crop_presets, provider_name, view_angle_override)
    relative_source_path = source_path or response.filename or image.filename or "image"
    source_dirs = output_source_dir_parts(relative_source_path)
    next_crops: list[CropResult] = []
    for crop in response.crops:
        crop_dir = output_dir.joinpath(*source_dirs)
        crop_dir.mkdir(parents=True, exist_ok=True)
        filename = output_crop_filename(relative_source_path, crop.presetId)
        output_path = crop_dir / filename
        output_path.write_bytes(base64.b64decode(crop.image))
        relative_output_path = output_path.relative_to(output_dir).as_posix()
        image_url = f"/api/batch-jobs/{job_id}/files/{relative_output_path}"
        next_crops.append(
            crop.model_copy(
                update={
                    "image": "",
                    "outputPath": str(output_path),
                    "imageUrl": image_url,
                }
            )
        )
    return response.model_copy(update={"crops": next_crops})


def find_archived_original(job: BatchJob, filename: str) -> tuple[str, bytes] | None:
    originals_dir = archive_originals_dir(Path(job.outputDir).expanduser())
    if not originals_dir.exists() or not originals_dir.is_dir():
        return None
    relative = normalize_relative_path(filename)
    safe_parts = [safe_path_part(part, "folder") for part in PurePosixPath(relative).parts[:-1]]
    safe_name = safe_path_part(PurePosixPath(relative).name or "image", "image")
    candidate = originals_dir.joinpath(*safe_parts, safe_name)
    if not candidate.exists() or not candidate.is_file():
        return None
    try:
        return relative, candidate.read_bytes()
    except OSError:
        return None


def remove_existing_outputs_for_source(job_dir: Path, source_path: str) -> None:
    search_root = job_dir.joinpath(*output_source_dir_parts(source_path))
    source_stem = output_source_stem(source_path)
    if not search_root.exists() or not search_root.is_dir():
        return
    for path in search_root.glob(f"{source_stem}_*.png"):
        try:
            if ORIGINALS_DIRNAME in path.relative_to(job_dir).parts:
                continue
            if path.is_file():
                path.unlink()
        except (OSError, ValueError):
            continue


def replace_batch_job_image_result(job: BatchJob, result: ProcessResponse, error: str = "") -> BatchJob:
    images: list[BatchJobImage] = []
    matched = False
    for image in job.images:
        if image.filename == result.filename:
            matched = True
            images.append(
                image.model_copy(
                    update={
                        "outputs": len(result.crops),
                        "error": error,
                        "reviewStatus": "pending_review",
                    }
                )
            )
        else:
            images.append(image)
    if not matched and result.filename:
        images.append(BatchJobImage(filename=result.filename, outputs=len(result.crops), error=error))
    output_count = sum(image.outputs for image in images)
    return job.model_copy(
        update={
            "images": images,
            "outputCount": output_count,
            "status": "completed" if output_count > 0 else "failed",
            "reviewStatus": "pending_review",
        }
    )


def load_batch_job_results(job: BatchJob) -> list[ProcessResponse]:
    job_dir = Path(job.outputDir).expanduser()
    if not job_dir.exists() or not job_dir.is_dir():
        return []

    presets_by_safe_id = {safe_filename(preset.id): preset for preset in load_presets()}
    results: list[ProcessResponse] = []
    for image_report in job.images:
        crops = load_batch_job_image_crops(job, job_dir, image_report.filename, presets_by_safe_id)
        if not crops:
            continue
        source = archived_source_size(job, image_report.filename)
        results.append(
            ProcessResponse(
                filename=image_report.filename,
                source=source,
                viewAngle="front",
                poseProvider=job.poseProvider,
                viewProvider=None,
                viewConfidence=None,
                keypoints=[],
                crops=crops,
            )
        )
    return results


def load_batch_job_image_crops(
    job: BatchJob,
    job_dir: Path,
    source_path: str,
    presets_by_safe_id: dict[str, CropPreset],
) -> list[CropResult]:
    source_stem = output_source_stem(source_path)
    search_root = job_dir.joinpath(*output_source_dir_parts(source_path))
    if not search_root.exists() or not search_root.is_dir():
        return []

    crops: list[CropResult] = []
    for path in sorted(search_root.glob(f"{source_stem}_*.png")):
        try:
            relative = path.relative_to(job_dir)
        except ValueError:
            continue
        if ORIGINALS_DIRNAME in relative.parts or not path.is_file():
            continue
        safe_preset_id = infer_safe_preset_id(path, source_stem)
        preset = presets_by_safe_id.get(safe_preset_id)
        try:
            with Image.open(path) as crop_image:
                width, height = crop_image.size
        except OSError:
            continue
        crops.append(
            CropResult(
                presetId=preset.id if preset else safe_preset_id,
                name=preset.name if preset else safe_preset_id,
                width=width,
                height=height,
                box={"left": 0, "top": 0, "right": width, "bottom": height},
                image="",
                outputPath=str(path),
                imageUrl=f"/api/batch-jobs/{job.id}/files/{relative.as_posix()}",
            )
        )
    return crops


def infer_safe_preset_id(path: Path, source_name: str) -> str:
    stem = path.stem
    prefix = f"{source_name}_"
    return stem[len(prefix):] if stem.startswith(prefix) else stem


def archived_source_size(job: BatchJob, filename: str) -> dict[str, int]:
    archived = find_archived_original(job, filename)
    if archived is None:
        return {"width": 0, "height": 0}
    try:
        with Image.open(BytesIO(archived[1])) as image:
            return {"width": image.width, "height": image.height}
    except OSError:
        return {"width": 0, "height": 0}


async def analyze_upload(
    image: UploadFile,
    provider_name: str | None = None,
    keypoint_scope: str = "body",
) -> PoseAnalysis:
    try:
        raw = await image.read()
        source_image = open_image_as_srgb(BytesIO(raw))
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Unsupported image file") from exc

    actual_provider = resolve_pose_provider_name(provider_name)
    pose = detect_pose(actual_provider, source_image)
    view_classification, view_trace = classify_view_with_trace(source_image, pose)
    logger.info(
        "analyze_poses_view_trace filename=%s pose_provider=%s image_size=%sx%s result=%s trace=%s",
        image.filename,
        actual_provider,
        source_image.width,
        source_image.height,
        view_classification.angle,
        json.dumps(view_trace, ensure_ascii=False, sort_keys=True),
    )
    return PoseAnalysis(
        filename=image.filename,
        source={"width": source_image.width, "height": source_image.height},
        viewAngle=view_classification.angle,
        poseProvider=actual_provider,
        viewProvider=view_classification.provider,
        viewConfidence=view_classification.confidence,
        keypoints=response_keypoints(pose, keypoint_scope),
    )


async def create_training_sample(
    preset_id: str,
    image: UploadFile,
    provider_name: str | None = None,
) -> TrainingSample:
    try:
        raw = await image.read()
        source_image = open_image_as_srgb(BytesIO(raw))
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Unsupported image file") from exc

    sample_id = make_sample_id()
    suffix = await save_upload_image(preset_id, sample_id, image, raw)
    actual_provider = resolve_pose_provider_name(provider_name)
    pose = detect_pose(actual_provider, source_image)
    view_classification = classify_view(source_image, pose)
    confidence = pose_confidence(pose.keypoints)
    return TrainingSample(
        id=sample_id,
        filename=image.filename or "image",
        imageUrl=sample_image_url(preset_id, sample_id, suffix),
        imageHash=hashlib.sha256(raw).hexdigest(),
        source={"width": source_image.width, "height": source_image.height},
        keypoints=pose.keypoints,
        viewAngle=view_classification.angle,
        viewProvider=view_classification.provider,
        viewConfidence=view_classification.confidence,
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
            source_image = open_image_as_srgb(image_path)
        except (UnidentifiedImageError, OSError):
            next_samples.append(sample)
            continue
        pose = detect_pose(actual_provider, source_image)
        view_classification = classify_view(source_image, pose)
        next_samples.append(
            sample.model_copy(
                update={
                    "source": {"width": source_image.width, "height": source_image.height},
                    "keypoints": pose.keypoints,
                    "viewAngle": view_classification.angle,
                    "viewProvider": view_classification.provider,
                    "viewConfidence": view_classification.confidence,
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
    image_paths: list[str] | None = Form(None),
    output_layout: str = Form(OUTPUT_LAYOUT_BY_PRESET),
) -> BatchJobResponse:
    job_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:6]
    created_at = datetime.now().isoformat(timespec="seconds")
    scenes = load_scenes()
    scene = next((item for item in scenes if item.id == scene_id), None)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    actual_provider = resolve_pose_provider_name(pose_provider)
    actual_output_layout = resolve_output_layout(output_layout)
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
                        filename=normalize_relative_path(
                            image_paths[index] if image_paths and index < len(image_paths) else image.filename
                        ),
                        outputs=0,
                        error="场景没有可用预设，请先在场景管理中绑定预设。",
                    )
                    for index, image in enumerate(images)
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
                        filename=normalize_relative_path(
                            image_paths[index] if image_paths and index < len(image_paths) else image.filename
                        ),
                        outputs=0,
                        error=f"输出目录不可写：{exc}",
                    )
                    for index, image in enumerate(images)
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
                        filename=normalize_relative_path(
                            image_paths[index] if image_paths and index < len(image_paths) else image.filename
                        ),
                        outputs=0,
                        error=f"任务目录不可写：{exc}",
                    )
                    for index, image in enumerate(images)
                ],
            )
        )
        return BatchJobResponse(job=job, images=[])

    uploaded: list[tuple[str, bytes]] = []
    for index, image in enumerate(images):
        raw = await image.read()
        filename = normalize_relative_path(
            image_paths[index] if image_paths and index < len(image_paths) else image.filename
        )
        uploaded.append((filename, raw))
    archive_originals(job_dir, uploaded)

    results: list[ProcessResponse] = []
    image_reports: list[BatchJobImage] = []
    for filename, raw in uploaded:
        upload = UploadFile(file=BytesIO(raw), filename=filename)
        try:
            result = await process_upload_to_output_dir(
                upload,
                crop_presets,
                job_dir,
                job_id,
                actual_provider,
                source_path=filename,
                output_layout=actual_output_layout,
            )
            results.append(result)
            image_reports.append(
                BatchJobImage(filename=filename, outputs=len(result.crops))
            )
        except HTTPException as exc:
            image_reports.append(
                BatchJobImage(filename=filename, outputs=0, error=str(exc.detail))
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


@app.post("/api/batch-jobs/{job_id}/rerun", response_model=BatchJobResponse)
async def rerun_batch_job(
    job_id: str,
    images: list[UploadFile] = File(...),
) -> BatchJobResponse:
    source_job = get_batch_job(job_id)
    if source_job is None:
        raise HTTPException(status_code=404, detail="Batch job not found")
    if not images:
        raise HTTPException(status_code=400, detail="重跑需要重新上传原图。")

    rerun_root = Path(source_job.outputDir).expanduser()
    if rerun_root.name == source_job.id:
        rerun_root = rerun_root.parent
    return await run_batch_job(
        images=images,
        scene_id=source_job.sceneId,
        output_dir=str(rerun_root),
        pose_provider=source_job.poseProvider,
    )


@app.post("/api/batch-jobs/{job_id}/images/{filename:path}/regenerate-view", response_model=BatchJobResponse)
async def regenerate_batch_job_image_with_view(
    job_id: str,
    filename: str,
    update: RegenerateViewUpdate,
) -> BatchJobResponse:
    job = get_batch_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Batch job not found")

    archived = find_archived_original(job, filename)
    if archived is None:
        raise HTTPException(status_code=400, detail="原图未归档，无法按修正朝向重生成。")
    source_path, raw = archived

    scenes = load_scenes()
    scene = next((item for item in scenes if item.id == job.sceneId), None)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")
    presets_by_id = {preset.id: preset for preset in load_presets()}
    bound_ids = [
        binding.presetId
        for binding in scene.presets
        if binding.enabled
    ] or scene.presetIds
    crop_presets = [presets_by_id[preset_id] for preset_id in bound_ids if preset_id in presets_by_id]
    if not crop_presets:
        raise HTTPException(status_code=400, detail="场景没有可用预设，请先在场景管理中绑定预设。")

    job_dir = Path(job.outputDir).expanduser()
    if not job_dir.exists() or not job_dir.is_dir():
        raise HTTPException(status_code=404, detail="Output directory not found")

    remove_existing_outputs_for_source(job_dir, source_path)
    upload = UploadFile(file=BytesIO(raw), filename=source_path)
    try:
        result = await process_upload_to_output_dir(
            upload,
            crop_presets,
            job_dir,
            job.id,
            job.poseProvider,
            source_path=source_path,
            view_angle_override=update.viewAngle,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    updated_job = append_batch_job(replace_batch_job_image_result(job, result))
    return BatchJobResponse(job=updated_job, images=[result])


async def _batch_job_events(
    uploaded: list[tuple[str, bytes]],
    scene_id: str,
    output_dir: str,
    pose_provider: str,
    output_layout: str = OUTPUT_LAYOUT_BY_PRESET,
):
    job_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:6]
    created_at = datetime.now().isoformat(timespec="seconds")
    total = len(uploaded)
    try:
        actual_provider = resolve_pose_provider_name(pose_provider)
        actual_output_layout = resolve_output_layout(output_layout)
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
                            filename=filename,
                            outputs=0,
                            error="场景没有可用预设，请先在场景管理中绑定预设。",
                        )
                        for filename, _ in uploaded
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
                            filename=filename,
                            outputs=0,
                            error=f"输出目录不可写：{exc}",
                        )
                        for filename, _ in uploaded
                    ],
                )
            )
            yield ndjson_event({"type": "final", "job": job.model_dump(mode="json"), "images": []})
            return

        archive_originals(job_dir, uploaded)

        yield ndjson_event(
            {
                "type": "start",
                "jobId": job_id,
                "total": total,
                "presetCount": len(crop_presets),
                "outputDir": str(job_dir),
                "files": [
                    {"filename": filename, "folder": source_folder_label(filename)}
                    for filename, _ in uploaded
                ],
            }
        )

        results: list[ProcessResponse] = []
        image_reports: list[BatchJobImage] = []
        for index, (filename, raw) in enumerate(uploaded, start=1):
            yield ndjson_event(
                {
                    "type": "active",
                    "jobId": job_id,
                    "completed": index - 1,
                    "total": total,
                    "filename": filename,
                    "folder": source_folder_label(filename),
                }
            )
            try:
                upload = UploadFile(file=BytesIO(raw), filename=filename)
                result = await process_upload_to_output_dir(
                    upload,
                    crop_presets,
                    job_dir,
                    job_id,
                    actual_provider,
                    source_path=filename,
                    output_layout=actual_output_layout,
                )
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
                        "folder": source_folder_label(filename),
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
                        "folder": source_folder_label(filename),
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
        try:
            job = append_batch_job(
                BatchJob(
                    id=job_id,
                    sceneId=scene_id,
                    sceneName=scene_id,
                    poseProvider=pose_provider,
                    outputDir=output_dir,
                    imageCount=total,
                    outputCount=0,
                    status="failed",
                    createdAt=created_at,
                    images=[
                        BatchJobImage(filename=filename, outputs=0, error=str(exc))
                        for filename, _ in uploaded
                    ],
                )
            )
        except Exception as store_exc:
            print(f"流式任务失败且无法写入任务记录: {store_exc}", flush=True)
            yield ndjson_event({"type": "error", "message": str(exc)})
            return
        yield ndjson_event(
            {"type": "error", "message": str(exc), "job": job.model_dump(mode="json")}
        )


@app.post("/api/batch-jobs/run-stream")
async def run_batch_job_stream(
    images: list[UploadFile] = File(...),
    scene_id: str = Form(...),
    output_dir: str = Form(...),
    pose_provider: str = Form("rtmw"),
    image_paths: list[str] | None = Form(None),
    output_layout: str = Form(OUTPUT_LAYOUT_BY_PRESET),
) -> StreamingResponse:
    # StreamingResponse 消费生成器时 FastAPI 已经关闭了上传文件的临时文件，
    # 因此必须在返回前把图片字节读进内存。
    uploaded = [
        (
            normalize_relative_path(
                image_paths[index] if image_paths and index < len(image_paths) else image.filename
            ),
            await image.read(),
        )
        for index, image in enumerate(images)
    ]
    return StreamingResponse(
        _batch_job_events(uploaded, scene_id, output_dir, pose_provider, output_layout),
        media_type="application/x-ndjson",
    )


@app.post("/api/batch-jobs/{job_id}/rerun-all")
async def rerun_batch_job_all(job_id: str) -> StreamingResponse:
    source_job = get_batch_job(job_id)
    if source_job is None:
        raise HTTPException(status_code=404, detail="Batch job not found")
    uploaded = load_archived_originals(source_job)
    if not uploaded:
        raise HTTPException(
            status_code=400,
            detail="原图未归档，无法整单重跑（该任务早于「原图归档」功能上线，请重新上传原图后跑一次新任务）。",
        )
    rerun_root = Path(source_job.outputDir).expanduser()
    if rerun_root.name == source_job.id:
        rerun_root = rerun_root.parent
    return StreamingResponse(
        _batch_job_events(uploaded, source_job.sceneId, str(rerun_root), source_job.poseProvider),
        media_type="application/x-ndjson",
    )


@app.post("/api/analyze-poses", response_model=PoseAnalysisBatchResponse)
async def analyze_poses(
    images: list[UploadFile] = File(...),
    pose_provider: str = Form("rtmw"),
    keypoint_scope: str = Form("body"),
) -> PoseAnalysisBatchResponse:
    return PoseAnalysisBatchResponse(
        images=[await analyze_upload(image, pose_provider, keypoint_scope) for image in images]
    )


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
