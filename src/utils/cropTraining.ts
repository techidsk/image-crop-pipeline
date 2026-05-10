import type { LearnedComposition, PoseKeypoint, TrainingSample } from "../types";

const bodyBoundKeypoints = new Set([
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
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
  "right_ankle"
]);

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function filterModels<T extends LearnedComposition>(models: T[]) {
  if (models.length < 3) {
    return {
      kept: models,
      rejected: [] as T[],
      center: null,
      threshold: Number.POSITIVE_INFINITY,
      diagnostics: models.map((model, index) => ({
        model,
        index,
        distance: 0,
        kept: true
      }))
    };
  }
  const bboxCenter = {
    left: median(models.map((item) => item.left)),
    top: median(models.map((item) => item.top)),
    width: median(models.map((item) => item.width)),
    height: median(models.map((item) => item.height))
  };
  const center = summarizeSemanticComposition(models) ?? bboxCenter;
  const distances = models.map((item) => semanticModelDistance(item, center));
  const distanceMedian = median(distances);
  const mad = median(distances.map((distance) => Math.abs(distance - distanceMedian)));
  const threshold = Math.max(0.08, distanceMedian + 2.5 * Math.max(mad, 0.01));
  const diagnostics = models.map((model, index) => ({
    model,
    index,
    distance: distances[index],
    kept: distances[index] <= threshold
  }));
  return {
    kept: diagnostics.filter((item) => item.kept).map((item) => item.model),
    rejected: diagnostics.filter((item) => !item.kept).map((item) => item.model),
    center,
    threshold,
    diagnostics
  };
}

export function personBounds(keypoints: PoseKeypoint[]) {
  let points = keypoints.filter((point) => point.confidence > 0.05 && bodyBoundKeypoints.has(point.name));
  if (points.length === 0) {
    points = keypoints.filter((point) => point.confidence > 0.05);
  }
  if (points.length === 0) return null;
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    confidence: median(points.map((point) => point.confidence))
  };
}

export function compositionForSample(sample: TrainingSample) {
  const bounds = personBounds(sample.keypoints);
  if (!bounds) return null;
  const semantic = semanticFrame(sample.keypoints);
  const fallback = {
    mode: "bbox" as const,
    left: (sample.crop.left - bounds.left) / bounds.width,
    top: (sample.crop.top - bounds.top) / bounds.height,
    width: sample.crop.width / bounds.width,
    height: sample.crop.height / bounds.height,
    outputWidth: sample.crop.width,
    outputHeight: sample.crop.height,
    explanation: "人体外接框比例"
  };
  if (!semantic) return fallback;
  const center = sample.crop.left + sample.crop.width / 2;
  const top = sample.crop.top;
  const bottom = sample.crop.top + sample.crop.height;
  const topMatch = closestSemanticY(top, semantic.topCandidates, semantic.verticalScale);
  const bottomMatch = closestSemanticY(bottom, semantic.bottomCandidates, semantic.verticalScale);
  return {
    ...fallback,
    mode: "pose_semantic" as const,
    centerAnchor: "torso_center",
    centerOffset: (center - semantic.centerX) / semantic.horizontalScale,
    centerScale: "body_width",
    topAnchor: topMatch.anchor,
    topOffset: topMatch.offset,
    topScale: "body_height",
    bottomAnchor: bottomMatch.anchor,
    bottomOffset: bottomMatch.offset,
    bottomScale: "body_height",
    semanticHeight: sample.crop.height / semantic.verticalScale,
    semanticWidth: sample.crop.width / semantic.horizontalScale,
    explanation: `上边界接近${topMatch.label}，下边界接近${bottomMatch.label}`
  };
}

export function summarizeSemanticComposition(models: LearnedComposition[]) {
  const semanticModels = models.filter((model) => model.mode === "pose_semantic" && model.topAnchor && model.bottomAnchor);
  if (semanticModels.length === 0) return null;
  const topAnchor = mostCommon(semanticModels.map((model) => model.topAnchor!));
  const bottomAnchor = mostCommon(semanticModels.map((model) => model.bottomAnchor!));
  const topModels = semanticModels.filter((model) => model.topAnchor === topAnchor);
  const bottomModels = semanticModels.filter((model) => model.bottomAnchor === bottomAnchor);
  const centerModels = semanticModels.filter((model) => model.centerOffset !== undefined);
  const heightModels = semanticModels.filter((model) => model.semanticHeight !== undefined);
  const widthModels = semanticModels.filter((model) => model.semanticWidth !== undefined);
  const topLabel = semanticAnchorLabel(topAnchor);
  const bottomLabel = semanticAnchorLabel(bottomAnchor);
  return {
    mode: "pose_semantic" as const,
    left: round4(median(semanticModels.map((model) => model.left))),
    top: round4(median(semanticModels.map((model) => model.top))),
    width: round4(median(semanticModels.map((model) => model.width))),
    height: round4(median(semanticModels.map((model) => model.height))),
    centerAnchor: "torso_center",
    centerOffset: round4(median(centerModels.map((model) => model.centerOffset ?? 0))),
    centerScale: "body_width",
    topAnchor,
    topOffset: round4(median(topModels.map((model) => model.topOffset ?? 0))),
    topScale: "body_height",
    bottomAnchor,
    bottomOffset: round4(median(bottomModels.map((model) => model.bottomOffset ?? 0))),
    bottomScale: "body_height",
    semanticHeight: round4(median(heightModels.map((model) => model.semanticHeight ?? 1))),
    semanticWidth: round4(median(widthModels.map((model) => model.semanticWidth ?? 1))),
    explanation: `上边界按${topLabel}，下边界按${bottomLabel}`
  };
}

export function semanticModelDistance(model: LearnedComposition, center: LearnedComposition) {
  if (model.mode !== "pose_semantic" || center.mode !== "pose_semantic") {
    return Math.hypot(model.left - center.left, model.top - center.top, model.width - center.width, model.height - center.height);
  }
  const anchorPenalty =
    semanticAnchorPenalty(model.topAnchor, center.topAnchor) + semanticAnchorPenalty(model.bottomAnchor, center.bottomAnchor);
  return Math.hypot(
    (model.topOffset ?? 0) - (center.topOffset ?? 0),
    (model.bottomOffset ?? 0) - (center.bottomOffset ?? 0),
    ((model.centerOffset ?? 0) - (center.centerOffset ?? 0)) * 0.25,
    anchorPenalty
  );
}

export function semanticAnchorLabel(anchor?: string) {
  const labels: Record<string, string> = {
    head_top: "头顶",
    face_top: "面部上沿",
    nose: "鼻子",
    neck: "脖子",
    shoulder: "肩线",
    chest: "胸口",
    hip: "髋部",
    thigh_30: "大腿30%",
    thigh_50: "大腿50%",
    knee: "膝盖",
    shin_50: "小腿50%",
    ankle: "脚踝"
  };
  return anchor ? labels[anchor] ?? anchor : "-";
}

function semanticFrame(keypoints: PoseKeypoint[]) {
  const point = (name: string) => keypoints.find((item) => item.name === name && item.confidence > 0.05);
  const avg = (names: string[]) => {
    const points = names.map(point).filter((item): item is PoseKeypoint => Boolean(item));
    if (points.length === 0) return null;
    return {
      x: median(points.map((item) => item.x)),
      y: median(points.map((item) => item.y)),
      confidence: median(points.map((item) => item.confidence))
    };
  };
  const shoulder = avg(["left_shoulder", "right_shoulder"]);
  const hip = avg(["left_hip", "right_hip"]);
  const knee = avg(["left_knee", "right_knee"]);
  const ankle = avg(["left_ankle", "right_ankle"]);
  const face = avg(["nose", "left_eye", "right_eye", "left_ear", "right_ear"]);
  if (!shoulder || !hip) return null;

  const bounds = personBounds(keypoints);
  if (!bounds) return null;
  const bodyHeight = Math.max(1, bounds.height);
  const bodyWidth = Math.max(1, bounds.width);
  const torsoHeight = Math.max(1, Math.abs(hip.y - shoulder.y));
  const faceTop = face ? Math.min(...["nose", "left_eye", "right_eye", "left_ear", "right_ear"].map(point).filter((item): item is PoseKeypoint => Boolean(item)).map((item) => item.y)) : bounds.top;
  const headTop = Math.min(faceTop - torsoHeight * 0.28, bounds.top);
  const neck = avg(["neck"]) ?? {
    x: shoulder.x,
    y: shoulder.y - torsoHeight * 0.12,
    confidence: shoulder.confidence
  };
  const chest = {
    x: shoulder.x + (hip.x - shoulder.x) * 0.35,
    y: shoulder.y + (hip.y - shoulder.y) * 0.35,
    confidence: Math.min(shoulder.confidence, hip.confidence)
  };
  const thigh30 = knee
    ? {
        x: hip.x + (knee.x - hip.x) * 0.3,
        y: hip.y + (knee.y - hip.y) * 0.3,
        confidence: Math.min(hip.confidence, knee.confidence)
      }
    : null;
  const thigh50 = knee
    ? {
        x: hip.x + (knee.x - hip.x) * 0.5,
        y: hip.y + (knee.y - hip.y) * 0.5,
        confidence: Math.min(hip.confidence, knee.confidence)
      }
    : null;
  const shin50 =
    knee && ankle
      ? {
          x: knee.x + (ankle.x - knee.x) * 0.5,
          y: knee.y + (ankle.y - knee.y) * 0.5,
          confidence: Math.min(knee.confidence, ankle.confidence)
        }
      : null;
  const centerX = median([shoulder.x, hip.x]);
  return {
    centerX,
    horizontalScale: bodyWidth,
    verticalScale: bodyHeight,
    topCandidates: [
      { anchor: "head_top", label: semanticAnchorLabel("head_top"), y: headTop },
      { anchor: "face_top", label: semanticAnchorLabel("face_top"), y: faceTop },
      ...(point("nose") ? [{ anchor: "nose", label: semanticAnchorLabel("nose"), y: point("nose")!.y }] : []),
      { anchor: "neck", label: semanticAnchorLabel("neck"), y: neck.y },
      { anchor: "shoulder", label: semanticAnchorLabel("shoulder"), y: shoulder.y },
      { anchor: "chest", label: semanticAnchorLabel("chest"), y: chest.y }
    ],
    bottomCandidates: [
      { anchor: "chest", label: semanticAnchorLabel("chest"), y: chest.y },
      { anchor: "hip", label: semanticAnchorLabel("hip"), y: hip.y },
      ...(thigh30 ? [{ anchor: "thigh_30", label: semanticAnchorLabel("thigh_30"), y: thigh30.y }] : []),
      ...(thigh50 ? [{ anchor: "thigh_50", label: semanticAnchorLabel("thigh_50"), y: thigh50.y }] : []),
      ...(knee ? [{ anchor: "knee", label: semanticAnchorLabel("knee"), y: knee.y }] : []),
      ...(shin50 ? [{ anchor: "shin_50", label: semanticAnchorLabel("shin_50"), y: shin50.y }] : []),
      ...(ankle ? [{ anchor: "ankle", label: semanticAnchorLabel("ankle"), y: ankle.y }] : [])
    ]
  };
}

function closestSemanticY(
  value: number,
  candidates: Array<{ anchor: string; label: string; y: number }>,
  scale: number
) {
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(value - candidate.y),
      offset: (value - candidate.y) / scale
    }))
    .sort((a, b) => a.distance - b.distance);
  return ranked[0];
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? values[0];
}

function semanticAnchorPenalty(anchor?: string, centerAnchor?: string) {
  if (!anchor || !centerAnchor || anchor === centerAnchor) return 0;
  const order = [
    "head_top",
    "face_top",
    "nose",
    "neck",
    "shoulder",
    "chest",
    "hip",
    "thigh_30",
    "thigh_50",
    "knee",
    "shin_50",
    "ankle"
  ];
  const index = order.indexOf(anchor);
  const centerIndex = order.indexOf(centerAnchor);
  if (index < 0 || centerIndex < 0) return 0.08;
  return Math.min(0.14, Math.abs(index - centerIndex) * 0.035);
}

export function normalizeAspectCrop(
  start: { x: number; y: number },
  end: { x: number; y: number },
  aspectRatio: number,
  imageWidth: number,
  imageHeight: number
) {
  const directionX = end.x >= start.x ? 1 : -1;
  const directionY = end.y >= start.y ? 1 : -1;
  const rawWidth = Math.abs(end.x - start.x);
  const rawHeight = Math.abs(end.y - start.y);
  let width = Math.max(rawWidth, rawHeight * aspectRatio);
  let height = width / aspectRatio;

  if (width < 1 || height < 1) {
    width = Math.max(1, width);
    height = Math.max(1, width / aspectRatio);
  }

  const left = directionX > 0 ? start.x : start.x - width;
  const top = directionY > 0 ? start.y : start.y - height;

  return clampCrop({ left, top, width, height }, imageWidth, imageHeight);
}

export function isPointInsideCrop(point: { x: number; y: number }, crop: TrainingSample["crop"]) {
  return (
    point.x >= crop.left &&
    point.x <= crop.left + crop.width &&
    point.y >= crop.top &&
    point.y <= crop.top + crop.height
  );
}

export function fitAspectCropAround(
  centerX: number,
  centerY: number,
  desiredWidth: number,
  aspectRatio: number,
  imageWidth: number,
  imageHeight: number
) {
  let width = Math.min(desiredWidth, imageWidth);
  let height = width / aspectRatio;
  if (height > imageHeight) {
    height = imageHeight;
    width = height * aspectRatio;
  }
  return clampCrop(
    {
      left: centerX - width / 2,
      top: centerY - height / 2,
      width,
      height
    },
    imageWidth,
    imageHeight
  );
}

export function clampCrop(crop: TrainingSample["crop"], imageWidth: number, imageHeight: number) {
  const width = Math.max(1, Math.min(crop.width, imageWidth));
  const height = Math.max(1, Math.min(crop.height, imageHeight));
  return {
    left: Math.max(0, Math.min(crop.left, imageWidth - width)),
    top: Math.max(0, Math.min(crop.top, imageHeight - height)),
    width,
    height
  };
}

export function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

export function parseTags(value: string) {
  return Array.from(new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean)));
}
