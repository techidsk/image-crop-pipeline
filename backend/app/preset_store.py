import json
from pathlib import Path

from pydantic import ValidationError

from .schemas import CropPreset
from .storage_provider import get_storage_provider


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
PRESETS_PATH = DATA_DIR / "presets.json"
PRESETS_KEY = "presets.json"


DEFAULT_PRESETS = [
    CropPreset(
        id="portrait-1800-2000",
        name="竖幅 1800x2000",
        tags=["portrait", "vertical"],
        width=1800,
        height=2000,
        anchor="neck",
        strategy="anchor_center",
        offsetX=0,
        offsetY=220,
        scale=1,
        protectHead=False,
        protectHands=False,
        orientation="front",
    ),
    CropPreset(
        id="upper-square-1600",
        name="上半身 1600x1600",
        tags=["upper-body", "square"],
        width=1600,
        height=1600,
        anchor="neck",
        strategy="anchor_top",
        offsetX=0,
        offsetY=-180,
        scale=1,
        protectHead=False,
        protectHands=False,
        orientation="front",
    ),
]


def ensure_store() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if get_storage_provider().read(PRESETS_KEY) is None:
        save_presets(DEFAULT_PRESETS)


def load_presets() -> list[CropPreset]:
    ensure_store()
    try:
        text = get_storage_provider().read(PRESETS_KEY)
        if text is None:
            return save_presets(DEFAULT_PRESETS)
        raw = json.loads(text)
        return [CropPreset.model_validate(item) for item in raw]
    except (json.JSONDecodeError, OSError, ValidationError):
        save_presets(DEFAULT_PRESETS)
        return DEFAULT_PRESETS


def save_presets(presets: list[CropPreset]) -> list[CropPreset]:
    content = json.dumps(
        [preset.model_dump(mode="json") for preset in presets],
        ensure_ascii=False,
        indent=2,
    )
    get_storage_provider().write(PRESETS_KEY, content)
    return presets
