import type { CropPreset, CropStrategy } from "./types";

export const anchors = ["neck", "mid_hip", "nose", "left_hip", "right_hip"];

export const strategyLabels: Record<CropStrategy, string> = {
  anchor_center: "锚点居中",
  anchor_top: "锚点定上边",
  full_height: "保留全高",
  learned_composition: "样本学习构图",
  pose_semantic_composition: "姿态语义构图"
};

export const defaultPresets: CropPreset[] = [
  {
    id: "portrait-1800-2000",
    name: "竖幅 1800x2000",
    tags: ["portrait", "vertical"],
    width: 1800,
    height: 2000,
    anchor: "neck",
    strategy: "anchor_center",
    offsetX: 0,
    offsetY: 220,
    scale: 1,
    composition: null,
    protectHead: false,
    protectHands: false,
    status: "draft",
    note: ""
  },
  {
    id: "upper-square-1600",
    name: "上半身 1600x1600",
    tags: ["upper-body", "square"],
    width: 1600,
    height: 1600,
    anchor: "neck",
    strategy: "anchor_top",
    offsetX: 0,
    offsetY: -180,
    scale: 1,
    composition: null,
    protectHead: false,
    protectHands: false,
    status: "draft",
    note: ""
  }
];
