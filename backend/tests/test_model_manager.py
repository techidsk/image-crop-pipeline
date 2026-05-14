import hashlib
import zipfile

from backend.app.model_manager import download_model, ensure_model_available


def test_download_model_extracts_onnx_from_zip(tmp_path):
    source_model = tmp_path / "source.onnx"
    source_model.write_bytes(b"onnx-model")
    archive_path = tmp_path / "model.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("readme.txt", "ignore")
        archive.write(source_model, "nested/rtmw.onnx")

    target_path = tmp_path / "models" / "rtmw-l-384x288.onnx"

    download_model(archive_path.as_uri(), target_path)

    assert target_path.read_bytes() == b"onnx-model"


def test_download_model_checks_sha256(tmp_path):
    source_model = tmp_path / "source.onnx"
    source_model.write_bytes(b"onnx-model")
    expected_sha256 = hashlib.sha256(b"onnx-model").hexdigest()
    target_path = tmp_path / "models" / "rtmw-l-384x288.onnx"

    download_model(source_model.as_uri(), target_path, expected_sha256)

    assert target_path.read_bytes() == b"onnx-model"


def test_ensure_model_available_skips_existing_model(tmp_path, monkeypatch):
    target_path = tmp_path / "models" / "rtmw-l-384x288.onnx"
    target_path.parent.mkdir()
    target_path.write_bytes(b"existing")
    missing_source = tmp_path / "missing.onnx"

    monkeypatch.setenv("POSE_PROVIDER", "rtmw")
    monkeypatch.setenv("MODEL_AUTO_DOWNLOAD", "true")
    monkeypatch.setenv("RTMW_ONNX_PATH", str(target_path))
    monkeypatch.setenv("RTMW_MODEL_URL", missing_source.as_uri())

    ensure_model_available()

    assert target_path.read_bytes() == b"existing"
