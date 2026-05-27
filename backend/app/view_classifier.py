import os
import tarfile
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

from .pose import Pose, classify_pose_view
from .schemas import PoseKeypoint, ViewAngle


VIEW_CLASSIFY_MAX_SIDE = int(os.getenv("VIEW_CLASSIFY_MAX_SIDE", "768"))
PADDLE_PERSON_ATTRIBUTE_URL = "https://paddleclas.bj.bcebos.com/models/PULC/inference/person_attribute_infer.tar"
DENSEPOSE_MIN_PIXELS = int(os.getenv("DENSEPOSE_MIN_PIXELS", "80"))
DENSEPOSE_MIN_CONFIDENCE = float(os.getenv("DENSEPOSE_MIN_CONFIDENCE", "0.35"))


def parse_densepose_parts_env(name: str, default: set[int]) -> set[int]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return {int(value.strip()) for value in raw.split(",") if value.strip()}
    except ValueError:
        return default


DENSEPOSE_FRONT_PARTS = parse_densepose_parts_env("DENSEPOSE_FRONT_PARTS", {1, 9, 10, 13, 14, 17, 18, 21, 22, 23})
DENSEPOSE_BACK_PARTS = parse_densepose_parts_env("DENSEPOSE_BACK_PARTS", {2, 7, 8, 11, 12, 15, 16, 19, 20, 24})


@dataclass(frozen=True)
class ViewClassification:
    angle: ViewAngle
    provider: str
    confidence: float | None = None


class PaddlePersonAttributeViewClassifier:
    def __init__(self) -> None:
        self._predictor: Any | None = None
        self._input_name: str | None = None
        self._output_name: str | None = None

    def classify(self, image: Image.Image, pose: Pose) -> ViewClassification | None:
        predictor = self._load_predictor()
        if predictor is None or self._input_name is None or self._output_name is None:
            return None

        crop = person_crop(image, pose)
        try:
            array = preprocess_person_attribute(crop)
            input_handle = predictor.get_input_handle(self._input_name)
            input_handle.copy_from_cpu(array)
            predictor.run()
            output = predictor.get_output_handle(self._output_name).copy_to_cpu()
            angle, confidence = parse_person_attribute_logits(output)
            return ViewClassification(angle=angle, provider="paddle_person_attribute", confidence=confidence)
        except Exception:
            return None

    def _load_predictor(self):
        if self._predictor is not None:
            return self._predictor
        try:
            from paddle.inference import Config, create_predictor
        except Exception:
            return None
        model_dir = ensure_person_attribute_model()
        model_file = model_dir / "inference.pdmodel"
        params_file = model_dir / "inference.pdiparams"
        if not model_file.exists() or not params_file.exists():
            return None
        try:
            config = Config(str(model_file), str(params_file))
            config.disable_gpu()
            config.enable_mkldnn()
            config.set_cpu_math_library_num_threads(int(os.getenv("PADDLE_CPU_THREADS", "4")))
            config.disable_glog_info()
            config.switch_ir_optim(True)
            config.enable_memory_optim()
            self._predictor = create_predictor(config)
            self._input_name = self._predictor.get_input_names()[0]
            self._output_name = self._predictor.get_output_names()[0]
        except Exception:
            return None
        return self._predictor


class DensePoseViewClassifier:
    """Optional DensePose IUV classifier loaded only when configured."""

    def __init__(self) -> None:
        self._predictor: Any | None = None
        self._extractor: Any | None = None
        self._load_attempted = False

    def classify(self, image: Image.Image, pose: Pose) -> ViewClassification | None:
        predictor = self._load_predictor()
        if predictor is None or self._extractor is None:
            return None

        try:
            import numpy as np

            crop = person_crop(image, pose)
            rgb = np.asarray(crop.convert("RGB"))
            bgr = np.ascontiguousarray(rgb[:, :, ::-1])
            instances = predictor(bgr).get("instances")
            if instances is None or len(instances) == 0:
                return None
            part_counts = densepose_part_counts(self._extractor(instances))
            return parse_densepose_part_counts(part_counts)
        except Exception:
            return None

    def _load_predictor(self):
        if self._predictor is not None:
            return self._predictor
        if self._load_attempted:
            return None
        self._load_attempted = True

        config_path = os.getenv("DENSEPOSE_CONFIG")
        weights_path = os.getenv("DENSEPOSE_WEIGHTS")
        if not config_path or not weights_path:
            return None

        try:
            from densepose import add_densepose_config
            from densepose.vis.extractor import DensePoseResultExtractor
            from detectron2.config import get_cfg
            from detectron2.engine import DefaultPredictor
        except Exception:
            return None

        try:
            cfg = get_cfg()
            add_densepose_config(cfg)
            cfg.merge_from_file(config_path)
            cfg.MODEL.WEIGHTS = weights_path
            cfg.MODEL.DEVICE = os.getenv("DENSEPOSE_DEVICE", "cpu")
            cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = float(os.getenv("DENSEPOSE_SCORE_THRESHOLD", "0.7"))
            self._predictor = DefaultPredictor(cfg)
            self._extractor = DensePoseResultExtractor()
        except Exception:
            return None
        return self._predictor


def classify_view(image: Image.Image, pose: Pose) -> ViewClassification:
    pose_result = ViewClassification(angle=classify_pose_view(pose, image), provider="pose_rule")
    providers = {
        value.strip()
        for value in os.getenv("VIEW_PROVIDER", "densepose,paddle").lower().replace(";", ",").split(",")
        if value.strip()
    }
    if providers & {"densepose", "dense_pose"}:
        densepose_result = densepose_view_classifier.classify(image, pose)
        if densepose_result is not None:
            return reconcile_densepose_classification(densepose_result, pose_result)
    if providers & {"paddle", "paddle_person_attribute"}:
        paddle_result = paddle_person_attribute_classifier.classify(image, pose)
        if paddle_result is not None:
            return reconcile_view_classification(paddle_result, pose_result)
    return pose_result


def reconcile_densepose_classification(
    densepose_result: ViewClassification,
    pose_result: ViewClassification,
) -> ViewClassification:
    if pose_result.angle == "side" or densepose_result.angle == "side":
        return pose_result
    if densepose_result.confidence is not None and densepose_result.confidence < DENSEPOSE_MIN_CONFIDENCE:
        return pose_result
    return densepose_result


def reconcile_view_classification(
    model_result: ViewClassification,
    pose_result: ViewClassification,
) -> ViewClassification:
    if pose_result.angle == "side" and model_result.angle != "side":
        return pose_result
    if model_result.angle == "side" and pose_result.angle != "side":
        return pose_result
    if model_result.angle == "back" and pose_result.angle == "front":
        return pose_result
    return model_result


def parse_densepose_part_counts(part_counts: dict[int, int]) -> ViewClassification | None:
    front_pixels = sum(part_counts.get(part, 0) for part in DENSEPOSE_FRONT_PARTS)
    back_pixels = sum(part_counts.get(part, 0) for part in DENSEPOSE_BACK_PARTS)
    relevant_pixels = front_pixels + back_pixels
    if relevant_pixels < DENSEPOSE_MIN_PIXELS:
        return None

    confidence = abs(front_pixels - back_pixels) / relevant_pixels
    if confidence < DENSEPOSE_MIN_CONFIDENCE:
        return None
    angle: ViewAngle = "front" if front_pixels > back_pixels else "back"
    return ViewClassification(angle=angle, provider="densepose", confidence=confidence)


def densepose_part_counts(result: Any) -> dict[int, int]:
    counts: dict[int, int] = {}
    for label_array in iter_densepose_labels(result):
        for label, count in densepose_label_histogram(label_array).items():
            if label <= 0:
                continue
            counts[label] = counts.get(label, 0) + count
    return counts


def iter_densepose_labels(value: Any) -> Iterable[Any]:
    if value is None:
        return
    if isinstance(value, dict):
        for key in ("labels", "i", "I"):
            if key in value:
                yield value[key]
        for item in value.values():
            yield from iter_densepose_labels(item)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from iter_densepose_labels(item)
        return
    for attr in ("labels", "i", "I"):
        if hasattr(value, attr):
            yield getattr(value, attr)


def densepose_label_histogram(labels: Any) -> dict[int, int]:
    import numpy as np

    array = np.asarray(labels)
    if array.size == 0:
        return {}
    values, counts = np.unique(array.astype("int32"), return_counts=True)
    return {int(value): int(count) for value, count in zip(values, counts)}


def person_crop(image: Image.Image, pose: Pose) -> Image.Image:
    bounds = person_bounds(pose)
    if bounds is None:
        return resize_for_classification(image)

    left, top, right, bottom = bounds
    width = right - left
    height = bottom - top
    margin_x = max(24.0, width * 0.18)
    margin_y = max(24.0, height * 0.08)
    crop_box = (
        max(0, round(left - margin_x)),
        max(0, round(top - margin_y)),
        min(image.width, round(right + margin_x)),
        min(image.height, round(bottom + margin_y)),
    )
    if crop_box[2] <= crop_box[0] or crop_box[3] <= crop_box[1]:
        return resize_for_classification(image)
    return resize_for_classification(image.crop(crop_box))


def resize_for_classification(image: Image.Image) -> Image.Image:
    max_side = max(image.width, image.height)
    if max_side <= VIEW_CLASSIFY_MAX_SIDE:
        return image
    scale = VIEW_CLASSIFY_MAX_SIDE / max_side
    return image.resize(
        (
            max(1, round(image.width * scale)),
            max(1, round(image.height * scale)),
        ),
        Image.Resampling.BILINEAR,
    )


def ensure_person_attribute_model() -> Path:
    model_dir = Path(os.getenv("PADDLE_PERSON_ATTRIBUTE_DIR", Path.home() / ".paddleclas" / "inference_model" / "PULC" / "person_attribute"))
    if (model_dir / "inference.pdmodel").exists() and (model_dir / "inference.pdiparams").exists():
        return model_dir
    model_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as temp:
        temp_path = Path(temp.name)
    try:
        import requests

        response = requests.get(PADDLE_PERSON_ATTRIBUTE_URL, timeout=60)
        response.raise_for_status()
        temp_path.write_bytes(response.content)
        with tarfile.open(temp_path) as archive:
            for member in archive.getmembers():
                if member.isfile() and Path(member.name).name in {"inference.pdmodel", "inference.pdiparams", "inference.pdiparams.info"}:
                    member.name = Path(member.name).name
                    archive.extract(member, model_dir)
    finally:
        try:
            temp_path.unlink()
        except OSError:
            pass
    return model_dir


def preprocess_person_attribute(image: Image.Image):
    import numpy as np

    resized = image.convert("RGB").resize((192, 256), Image.Resampling.BILINEAR)
    array = np.asarray(resized).astype("float32") / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype="float32")
    std = np.array([0.229, 0.224, 0.225], dtype="float32")
    array = (array - mean) / std
    return array.transpose(2, 0, 1)[None, ...].astype("float32")


def person_bounds(pose: Pose) -> tuple[float, float, float, float] | None:
    body_names = {
        "nose",
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
    points: list[PoseKeypoint] = []
    for name in body_names:
        point = pose.point(name)
        if point is not None and point.confidence > 0.05:
            points.append(point)
    if not points:
        return None
    left = min(point.x for point in points)
    top = min(point.y for point in points)
    right = max(point.x for point in points)
    bottom = max(point.y for point in points)
    if right <= left or bottom <= top:
        return None
    return left, top, right, bottom


def parse_paddle_direction(outputs: Any) -> ViewAngle | None:
    values = list(flatten_output(outputs))
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.lower()
        if "direction" not in normalized and normalized not in {"front", "side", "back"}:
            continue
        if "back" in normalized:
            return "back"
        if "side" in normalized:
            return "side"
        if "front" in normalized:
            return "front"
    return None


def parse_person_attribute_logits(outputs: Any) -> tuple[ViewAngle, float]:
    import numpy as np

    logits = np.asarray(outputs).reshape(-1)
    direction_scores = logits[23:26]
    index = int(np.argmax(direction_scores))
    return ["front", "side", "back"][index], float(direction_scores[index])


def flatten_output(value: Any):
    if isinstance(value, dict):
        for item in value.values():
            yield from flatten_output(item)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from flatten_output(item)
        return
    yield value


paddle_person_attribute_classifier = PaddlePersonAttributeViewClassifier()
densepose_view_classifier = DensePoseViewClassifier()
