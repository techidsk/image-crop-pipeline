import json

from pydantic import ValidationError

from .preset_store import DATA_DIR
from .schemas import CropScene
from .storage_provider import get_storage_provider


SCENES_PATH = DATA_DIR / "scenes.json"
SCENES_KEY = "scenes.json"


DEFAULT_SCENES = [
    CropScene(
        id="default-brand-scene",
        name="默认品牌批量裁图",
        brand="通用",
        tags=["default"],
        description="按当前可用预设批量生成运营素材。",
        presetIds=["portrait-1800-2000", "upper-square-1600"],
        status="draft",
    )
]


def ensure_scene_store() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if get_storage_provider().read(SCENES_KEY) is None:
        save_scenes(DEFAULT_SCENES)


def load_scenes() -> list[CropScene]:
    ensure_scene_store()
    try:
        text = get_storage_provider().read(SCENES_KEY)
        if text is None:
            return save_scenes(DEFAULT_SCENES)
        raw = json.loads(text)
        return [CropScene.model_validate(item) for item in raw]
    except (json.JSONDecodeError, OSError, ValidationError):
        save_scenes(DEFAULT_SCENES)
        return DEFAULT_SCENES


def save_scenes(scenes: list[CropScene]) -> list[CropScene]:
    content = json.dumps(
        [scene.model_dump(mode="json") for scene in scenes], ensure_ascii=False, indent=2
    )
    get_storage_provider().write(SCENES_KEY, content)
    return scenes
