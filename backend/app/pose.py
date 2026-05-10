import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from PIL import Image

from .schemas import PoseKeypoint


OPENPOSE_BODY_18 = [
    "nose",
    "neck",
    "right_shoulder",
    "right_elbow",
    "right_wrist",
    "left_shoulder",
    "left_elbow",
    "left_wrist",
    "right_hip",
    "right_knee",
    "right_ankle",
    "left_hip",
    "left_knee",
    "left_ankle",
    "right_eye",
    "left_eye",
    "right_ear",
    "left_ear",
]

COCO_WHOLEBODY_133 = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
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
    *[f"left_foot_{index}" for index in range(1, 7)],
    *[f"right_foot_{index}" for index in range(1, 7)],
    *[f"face_{index}" for index in range(1, 69)],
    *[f"left_hand_{index}" for index in range(1, 22)],
    *[f"right_hand_{index}" for index in range(1, 22)],
]


@dataclass(frozen=True)
class Pose:
    keypoints: list[PoseKeypoint]

    def point(self, name: str) -> PoseKeypoint | None:
        if name == "neck":
            left = self.point("left_shoulder")
            right = self.point("right_shoulder")
            if left and right:
                return PoseKeypoint(
                    name="neck",
                    x=(left.x + right.x) / 2,
                    y=(left.y + right.y) / 2,
                    confidence=min(left.confidence, right.confidence),
                )
        if name == "mid_hip":
            left = self.point("left_hip")
            right = self.point("right_hip")
            if left and right:
                return PoseKeypoint(
                    name="mid_hip",
                    x=(left.x + right.x) / 2,
                    y=(left.y + right.y) / 2,
                    confidence=min(left.confidence, right.confidence),
                )
        return next((point for point in self.keypoints if point.name == name), None)


class PoseProvider(ABC):
    @abstractmethod
    def detect(self, image: Image.Image) -> Pose:
        raise NotImplementedError


class HeuristicPoseProvider(PoseProvider):
    """Deterministic stand-in provider until a real OpenPose runtime is wired in."""

    def detect(self, image: Image.Image) -> Pose:
        width, height = image.size
        coordinates = {
            "nose": (0.50, 0.22),
            "neck": (0.50, 0.34),
            "right_shoulder": (0.40, 0.36),
            "right_elbow": (0.33, 0.52),
            "right_wrist": (0.30, 0.68),
            "left_shoulder": (0.60, 0.36),
            "left_elbow": (0.67, 0.52),
            "left_wrist": (0.70, 0.68),
            "right_hip": (0.43, 0.60),
            "right_knee": (0.42, 0.78),
            "right_ankle": (0.41, 0.94),
            "left_hip": (0.57, 0.60),
            "left_knee": (0.58, 0.78),
            "left_ankle": (0.59, 0.94),
            "right_eye": (0.47, 0.20),
            "left_eye": (0.53, 0.20),
            "right_ear": (0.44, 0.22),
            "left_ear": (0.56, 0.22),
        }
        return Pose(
            keypoints=[
                PoseKeypoint(name=name, x=width * x, y=height * y, confidence=0.75)
                for name, (x, y) in coordinates.items()
            ]
        )


class RTMWOnnxPoseProvider(PoseProvider):
    """RTMW-l whole-body provider backed by ONNX Runtime.

    This expects a top-down RTMW/RTMPose-style ONNX model exported for one
    person crop. The current app passes the whole image as the subject crop.
    """

    def __init__(
        self,
        model_path: str,
        input_width: int = 288,
        input_height: int = 384,
        providers: list[str] | None = None,
    ) -> None:
        try:
            import numpy as np
            import onnxruntime as ort
        except ImportError as exc:
            raise RuntimeError(
                "RTMW ONNX provider requires optional dependencies. Install backend/requirements-onnx.txt."
            ) from exc

        path = Path(model_path)
        if not path.exists():
            raise RuntimeError(f"RTMW_ONNX_PATH does not exist: {path}")

        self.np = np
        self.input_width = input_width
        self.input_height = input_height
        options = ort.SessionOptions()
        options.log_severity_level = 3
        self.session = ort.InferenceSession(
            str(path),
            sess_options=options,
            providers=providers or ["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name

    def detect(self, image: Image.Image) -> Pose:
        width, height = image.size
        tensor = self._preprocess(image)
        outputs = self.session.run(None, {self.input_name: tensor})
        coordinates, scores = self._parse_outputs(outputs)

        keypoints = []
        for index, point in enumerate(coordinates[: len(COCO_WHOLEBODY_133)]):
            x = float(point[0])
            y = float(point[1])
            confidence = float(scores[index]) if index < len(scores) else 1.0
            keypoints.append(
                PoseKeypoint(
                    name=COCO_WHOLEBODY_133[index],
                    x=x * width / self.input_width,
                    y=y * height / self.input_height,
                    confidence=confidence,
                )
            )
        return Pose(keypoints=keypoints)

    def _preprocess(self, image: Image.Image):
        np = self.np
        resized = image.convert("RGB").resize((self.input_width, self.input_height), Image.Resampling.BILINEAR)
        array = np.asarray(resized).astype("float32")
        mean = np.array([123.675, 116.28, 103.53], dtype="float32")
        std = np.array([58.395, 57.12, 57.375], dtype="float32")
        array = (array - mean) / std
        return array.transpose(2, 0, 1)[None, ...].astype("float32")

    def _parse_outputs(self, outputs):
        np = self.np
        arrays = [np.asarray(output) for output in outputs]
        simcc_x = next((array for array in arrays if array.ndim == 3 and array.shape[-1] == self.input_width * 2), None)
        simcc_y = next((array for array in arrays if array.ndim == 3 and array.shape[-1] == self.input_height * 2), None)
        if simcc_x is not None and simcc_y is not None:
            x_logits = simcc_x[0]
            y_logits = simcc_y[0]
            x_index = np.argmax(x_logits, axis=1).astype("float32")
            y_index = np.argmax(y_logits, axis=1).astype("float32")
            coordinates = np.stack([x_index / 2.0, y_index / 2.0], axis=1)
            scores = sigmoid(np.minimum(x_logits.max(axis=1), y_logits.max(axis=1))).astype("float32")
            return coordinates, scores

        keypoints = next(
            (
                array
                for array in arrays
                if array.ndim >= 2 and array.shape[-1] in {2, 3} and array.reshape(-1, array.shape[-1]).shape[0] >= 17
            ),
            None,
        )
        if keypoints is None:
            raise RuntimeError("RTMW ONNX output did not include keypoint coordinates")

        flattened = keypoints.reshape(-1, keypoints.shape[-1])
        coordinates = flattened[:, :2].astype("float32")
        if coordinates.size and float(coordinates.max()) <= 1.5:
            coordinates[:, 0] *= self.input_width
            coordinates[:, 1] *= self.input_height

        if flattened.shape[1] >= 3:
            scores = flattened[:, 2].astype("float32")
        else:
            score_array = next(
                (
                    array
                    for array in arrays
                    if array is not keypoints and array.size >= coordinates.shape[0] and array.ndim <= 3
                ),
                None,
            )
            scores = score_array.reshape(-1).astype("float32") if score_array is not None else np.ones(coordinates.shape[0])
        return coordinates, scores

def sigmoid(values):
    np = __import__("numpy")
    return 1.0 / (1.0 + np.exp(-values))


class RTMWTransformersPoseProvider(PoseProvider):
    """RTMW-l whole-body provider using the optional Hugging Face port."""

    def __init__(self, model_name: str = "akore/rtmw-l-384x288") -> None:
        try:
            import torch
            from transformers import AutoImageProcessor, AutoModel
        except ImportError as exc:
            raise RuntimeError(
                "RTMW Transformers provider requires optional dependencies. Install backend/requirements-rtmw.txt."
            ) from exc

        self.torch = torch
        self.processor = AutoImageProcessor.from_pretrained(model_name, trust_remote_code=True)
        self.model = AutoModel.from_pretrained(model_name, trust_remote_code=True).eval()
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model.to(self.device)

    def detect(self, image: Image.Image) -> Pose:
        width, height = image.size
        inputs = self.processor(images=image.convert("RGB"), return_tensors="pt")
        inputs = {key: value.to(self.device) for key, value in inputs.items()}
        bbox = self.torch.tensor([[0, 0, width, height]], dtype=self.torch.float32, device=self.device)
        with self.torch.no_grad():
            output = self.model(**inputs, coordinate_mode="image", bbox=bbox)

        keypoints = output.keypoints[0].detach().cpu().tolist()
        scores = output.scores[0].detach().cpu().tolist()
        return Pose(
            keypoints=[
                PoseKeypoint(
                    name=COCO_WHOLEBODY_133[index] if index < len(COCO_WHOLEBODY_133) else f"keypoint_{index}",
                    x=float(point[0]),
                    y=float(point[1]),
                    confidence=float(scores[index]),
                )
                for index, point in enumerate(keypoints)
            ]
        )


def make_pose_provider(provider_name: str | None = None) -> PoseProvider:
    provider = (provider_name or os.getenv("POSE_PROVIDER", "heuristic")).lower()
    if provider in {"rtmw", "rtmw_onnx"}:
        return RTMWOnnxPoseProvider(
            os.getenv("RTMW_ONNX_PATH", "models/rtmw-l-384x288.onnx"),
            input_width=int(os.getenv("RTMW_INPUT_WIDTH", "288")),
            input_height=int(os.getenv("RTMW_INPUT_HEIGHT", "384")),
        )
    if provider in {"rtmw_transformers", "transformers"}:
        return RTMWTransformersPoseProvider(os.getenv("RTMW_MODEL", "akore/rtmw-l-384x288"))
    return HeuristicPoseProvider()
