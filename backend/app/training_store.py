import json
import re
import shutil
import uuid
from pathlib import Path

from fastapi import UploadFile
from pydantic import ValidationError

from .schemas import TrainingSample


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
TRAINING_DIR = DATA_DIR / "training_samples"


def safe_id(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_")
    return cleaned or "preset"


def sample_dir(preset_id: str) -> Path:
    return TRAINING_DIR / safe_id(preset_id)


def sample_json_path(preset_id: str) -> Path:
    return sample_dir(preset_id) / "samples.json"


def image_dir(preset_id: str) -> Path:
    return sample_dir(preset_id) / "images"


def load_training_samples(preset_id: str) -> list[TrainingSample]:
    path = sample_json_path(preset_id)
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return [TrainingSample.model_validate(item) for item in raw]
    except (json.JSONDecodeError, OSError, ValidationError):
        return []


def save_training_samples(preset_id: str, samples: list[TrainingSample]) -> list[TrainingSample]:
    directory = sample_dir(preset_id)
    directory.mkdir(parents=True, exist_ok=True)
    sample_json_path(preset_id).write_text(
        json.dumps(
            [sample.model_dump(mode="json") for sample in samples],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return samples


def append_training_samples(preset_id: str, samples: list[TrainingSample]) -> list[TrainingSample]:
    existing_samples = load_training_samples(preset_id)
    existing_keys = {dedupe_key(sample) for sample in existing_samples}
    next_samples = [*existing_samples]
    for sample in samples:
        key = dedupe_key(sample)
        if key in existing_keys:
            continue
        existing_keys.add(key)
        next_samples.append(sample)
    return save_training_samples(preset_id, next_samples)


def dedupe_key(sample: TrainingSample) -> str:
    if sample.imageHash:
        return f"hash:{sample.imageHash}"
    width = sample.source.get("width", 0)
    height = sample.source.get("height", 0)
    return f"legacy:{sample.filename}:{width}x{height}"


def make_sample_id() -> str:
    return uuid.uuid4().hex


def sample_image_url(preset_id: str, sample_id: str, suffix: str) -> str:
    return f"/api/presets/{safe_id(preset_id)}/training-samples/{sample_id}/image{suffix}"


async def save_upload_image(preset_id: str, sample_id: str, upload: UploadFile, raw: bytes) -> str:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"
    directory = image_dir(preset_id)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{sample_id}{suffix}"
    with path.open("wb") as file:
        file.write(raw)
    return suffix


def resolve_image_path(preset_id: str, sample_id: str, suffix: str) -> Path:
    return image_dir(preset_id) / f"{sample_id}{suffix}"


def find_sample_image_path(preset_id: str, sample_id: str) -> Path | None:
    directory = image_dir(preset_id)
    if not directory.exists():
        return None
    for suffix in (".png", ".jpg", ".jpeg", ".webp"):
        path = directory / f"{sample_id}{suffix}"
        if path.exists():
            return path
    return None
