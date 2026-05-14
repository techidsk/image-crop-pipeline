import hashlib
import os
import shutil
import tempfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path


DEFAULT_RTMW_MODEL_URL = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/"
    "rtmw-dw-x-l_simcc-cocktail14_270e-384x288_20231122.zip"
)


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def ensure_model_available() -> None:
    provider = os.getenv("POSE_PROVIDER", "heuristic").lower()
    if provider not in {"rtmw", "rtmw_onnx"}:
        return
    if not env_flag("MODEL_AUTO_DOWNLOAD"):
        return

    target_path = Path(os.getenv("RTMW_ONNX_PATH", "models/rtmw-l-384x288.onnx"))
    if target_path.exists() and target_path.stat().st_size > 0:
        return

    download_url = os.getenv("RTMW_MODEL_URL", DEFAULT_RTMW_MODEL_URL)
    expected_sha256 = os.getenv("RTMW_MODEL_SHA256", "").strip().lower()
    try:
        download_model(download_url, target_path, expected_sha256 or None)
    except Exception as exc:
        if env_flag("MODEL_DOWNLOAD_REQUIRED"):
            raise RuntimeError(f"Failed to download RTMW model: {exc}") from exc
        print(f"Failed to download RTMW model, falling back if possible: {exc}", flush=True)


def download_model(url: str, target_path: Path, expected_sha256: str | None = None) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target_path.parent) as temp_dir:
        temp_root = Path(temp_dir)
        archive_path = temp_root / "model.download"
        urllib.request.urlretrieve(url, archive_path)

        parsed_path = urllib.parse.urlparse(url).path.lower()
        if parsed_path.endswith(".zip") or zipfile.is_zipfile(archive_path):
            extracted_path = extract_onnx_from_zip(archive_path, temp_root)
            staged_path = temp_root / target_path.name
            shutil.move(str(extracted_path), staged_path)
        else:
            staged_path = archive_path

        if expected_sha256:
            actual_sha256 = file_sha256(staged_path)
            if actual_sha256 != expected_sha256:
                raise RuntimeError(
                    f"Downloaded model SHA256 mismatch: expected {expected_sha256}, got {actual_sha256}"
                )

        final_temp_path = target_path.with_suffix(target_path.suffix + ".part")
        if final_temp_path.exists():
            final_temp_path.unlink()
        shutil.move(str(staged_path), final_temp_path)
        final_temp_path.replace(target_path)


def extract_onnx_from_zip(archive_path: Path, destination: Path) -> Path:
    with zipfile.ZipFile(archive_path) as archive:
        candidates = [
            item
            for item in archive.infolist()
            if not item.is_dir() and item.filename.lower().endswith(".onnx")
        ]
        if not candidates:
            raise RuntimeError("Downloaded model archive does not contain an ONNX file")

        model_entry = max(candidates, key=lambda item: item.file_size)
        extracted_path = destination / Path(model_entry.filename).name
        with archive.open(model_entry) as source, extracted_path.open("wb") as target:
            shutil.copyfileobj(source, target)
        return extracted_path


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
