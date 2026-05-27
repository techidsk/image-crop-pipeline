export type AppView = "batch" | "viewTest" | "presetList" | "presetEditor" | "sceneList" | "batchJobs";
export type PoseProviderId = "rtmw" | "heuristic";
export type ViewAngle = "front" | "side" | "back";
export type ReviewStatus = "pending_review" | "approved" | "rejected";

export type CropStrategy = "anchor_center" | "anchor_top" | "full_height" | "learned_composition" | "pose_semantic_composition";
export type PresetStatus = "draft" | "incomplete" | "ready" | "archived";

export type LearnedComposition = {
  mode?: "bbox" | "pose_semantic";
  left: number;
  top: number;
  width: number;
  height: number;
  centerAnchor?: string;
  centerOffset?: number;
  centerScale?: string;
  topAnchor?: string;
  topOffset?: number;
  topScale?: string;
  bottomAnchor?: string;
  bottomOffset?: number;
  bottomScale?: string;
  semanticHeight?: number;
  semanticWidth?: number;
  explanation?: string;
};

export type CropPreset = {
  id: string;
  name: string;
  tags: string[];
  width: number;
  height: number;
  anchor: string;
  strategy: CropStrategy;
  offsetX: number;
  offsetY: number;
  scale: number;
  composition?: LearnedComposition | null;
  protectHead?: boolean;
  protectHands?: boolean;
  orientation: ViewAngle;
  viewAngles?: ViewAngle[];
  status?: PresetStatus;
  note?: string;
};

export type CropResult = {
  presetId: string;
  name: string;
  width: number;
  height: number;
  box: { left: number; top: number; right: number; bottom: number };
  image: string;
  outputPath?: string | null;
  imageUrl?: string | null;
};

export type ProcessResponse = {
  filename?: string;
  source: { width: number; height: number };
  viewAngle: ViewAngle;
  keypoints: Array<{ name: string; x: number; y: number; confidence: number }>;
  crops: CropResult[];
};

export type PoseKeypoint = ProcessResponse["keypoints"][number];

export type PoseAnalysis = {
  filename?: string;
  source: { width: number; height: number };
  viewAngle?: ViewAngle;
  keypoints: PoseKeypoint[];
};

export type TrainingSample = {
  id: string;
  filename: string;
  imageUrl: string;
  imageHash?: string | null;
  previewUrl: string;
  source: { width: number; height: number };
  keypoints: PoseKeypoint[];
  viewAngle?: ViewAngle;
  crop: { left: number; top: number; width: number; height: number };
  poseProvider?: PoseProviderId | "unknown";
  confidence: number;
  confirmed: boolean;
  set: "train" | "test";
  cropPreviewUrl?: string | null;
};

export type CropDragState =
  | { mode: "draw"; start: { x: number; y: number } }
  | { mode: "move"; offsetX: number; offsetY: number }
  | {
      mode: "resize";
      handle: ResizeHandle;
      origin: TrainingSample["crop"];
    };

export type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "se" | "sw" | "nw";

export type ScenePresetBinding = {
  presetId: string;
  enabled: boolean;
  alias: string;
};

export type CropScene = {
  id: string;
  name: string;
  brand: string;
  tags: string[];
  description: string;
  presetIds: string[];
  presets: ScenePresetBinding[];
  status: "draft" | "active" | "archived";
};

export type BatchJobImage = {
  filename: string;
  outputs: number;
  error: string;
  reviewStatus: ReviewStatus;
};

export type BatchJob = {
  id: string;
  sceneId: string;
  sceneName: string;
  poseProvider: string;
  outputDir: string;
  imageCount: number;
  outputCount: number;
  status: "completed" | "failed" | "running";
  reviewStatus: ReviewStatus;
  createdAt: string;
  images: BatchJobImage[];
};
