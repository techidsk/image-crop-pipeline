import json

from pydantic import ValidationError

from .preset_store import DATA_DIR
from .schemas import ExportSettings
from .storage_provider import get_storage_provider


EXPORT_SETTINGS_KEY = "export_settings.json"
DEFAULT_EXPORT_SETTINGS = ExportSettings()


def ensure_export_settings_store() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if get_storage_provider().read(EXPORT_SETTINGS_KEY) is None:
        save_export_settings(DEFAULT_EXPORT_SETTINGS)


def load_export_settings() -> ExportSettings:
    ensure_export_settings_store()
    try:
        text = get_storage_provider().read(EXPORT_SETTINGS_KEY)
        if text is None:
            return save_export_settings(DEFAULT_EXPORT_SETTINGS)
        return ExportSettings.model_validate(json.loads(text))
    except (json.JSONDecodeError, OSError, ValidationError):
        return save_export_settings(DEFAULT_EXPORT_SETTINGS)


def save_export_settings(settings: ExportSettings) -> ExportSettings:
    content = json.dumps(settings.model_dump(mode="json"), ensure_ascii=False, indent=2)
    get_storage_provider().write(EXPORT_SETTINGS_KEY, content)
    return settings
