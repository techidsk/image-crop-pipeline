from typing import Any

from pydantic import BaseModel, Field


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


class ProcessResponse(BaseModel):
    filename: str | None = None
    source: dict[str, int]
    keypoints: list[PoseKeypoint]
    crops: list[CropResult]


class BatchProcessResponse(BaseModel):
    images: list[ProcessResponse]


class PoseAnalysis(BaseModel):
    filename: str | None = None
    source: dict[str, int]
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
    crop: TrainingCrop
    poseProvider: str = "unknown"
    confidence: float = 0
    confirmed: bool = False
    set: str = "train"


class TrainingSampleBatchResponse(BaseModel):
    samples: list[TrainingSample]
