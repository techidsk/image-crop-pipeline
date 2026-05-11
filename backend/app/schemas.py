from typing import Any, Literal

from pydantic import BaseModel, Field

ViewAngle = Literal["front", "side", "back"]


class CropPreset(BaseModel):
    id: str
    name: str
    tags: list[str] = []
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    anchor: str
    strategy: str = "anchor_center"
    offsetX: float = 0
    offsetY: float = 0
    scale: float = Field(default=1, gt=0)
    composition: dict[str, Any] | None = None
    protectHead: bool = False
    protectHands: bool = False
    orientation: ViewAngle = "front"
    viewAngles: list[ViewAngle] = Field(default_factory=lambda: ["front", "side", "back"])
    status: str = "draft"
    note: str = ""


class PoseKeypoint(BaseModel):
    name: str
    x: float
    y: float
    confidence: float


class CropBox(BaseModel):
    left: int
    top: int
    right: int
    bottom: int


class CropResult(BaseModel):
    presetId: str
    name: str
    width: int
    height: int
    box: CropBox
    image: str
    outputPath: str | None = None


class ProcessResponse(BaseModel):
    filename: str | None = None
    source: dict[str, int]
    viewAngle: ViewAngle
    keypoints: list[PoseKeypoint]
    crops: list[CropResult]


class BatchProcessResponse(BaseModel):
    images: list[ProcessResponse]


class PoseAnalysis(BaseModel):
    filename: str | None = None
    source: dict[str, int]
    viewAngle: ViewAngle
    keypoints: list[PoseKeypoint]


class PoseAnalysisBatchResponse(BaseModel):
    images: list[PoseAnalysis]


class TrainingCrop(BaseModel):
    left: float
    top: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class TrainingSample(BaseModel):
    id: str
    filename: str
    imageUrl: str
    source: dict[str, int]
    keypoints: list[PoseKeypoint]
    viewAngle: ViewAngle = "front"
    crop: TrainingCrop
    poseProvider: str = "unknown"
    confidence: float = 0
    confirmed: bool = False
    set: str = "train"


class TrainingSampleBatchResponse(BaseModel):
    samples: list[TrainingSample]


class ScenePresetBinding(BaseModel):
    presetId: str
    enabled: bool = True
    alias: str = ""


class CropScene(BaseModel):
    id: str
    name: str
    brand: str = ""
    tags: list[str] = []
    description: str = ""
    presetIds: list[str] = []
    presets: list[ScenePresetBinding] = []
    status: str = "draft"


class BatchJobImage(BaseModel):
    filename: str
    outputs: int
    error: str = ""


class BatchJob(BaseModel):
    id: str
    sceneId: str
    sceneName: str
    poseProvider: str
    outputDir: str
    imageCount: int
    outputCount: int
    status: str
    createdAt: str
    images: list[BatchJobImage] = []


class BatchJobResponse(BaseModel):
    job: BatchJob
    images: list[ProcessResponse]
