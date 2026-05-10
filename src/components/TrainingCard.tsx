import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Check, Eye, EyeOff, ScanSearch } from "lucide-react";
import { NumberField } from "./NumberField";
import type { CropDragState, ResizeHandle, TrainingSample } from "../types";
import {
  clampCrop,
  isPointInsideCrop,
  normalizeAspectCrop,
  personBounds
} from "../utils/cropTraining";

type TrainingCardProps = {
  aspectRatio: number;
  sample: TrainingSample;
  onConfirm: (sample: TrainingSample) => void;
  onPreview: (sample: TrainingSample) => void;
  onUpdate: (id: string, patch: Partial<TrainingSample>) => void;
};

export function TrainingCard({ aspectRatio, sample, onConfirm, onPreview, onUpdate }: TrainingCardProps) {
  const [showPose, setShowPose] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const cropRef = useRef(sample.crop);
  const dragStateRef = useRef<CropDragState | null>(null);
  const frameRef = useRef<number | null>(null);
  const bounds = personBounds(sample.keypoints);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !image.complete) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, sample.source.width, sample.source.height);
    context.drawImage(image, 0, 0, sample.source.width, sample.source.height);

    if (showPose && bounds) {
      context.save();
      context.setLineDash([14, 10]);
      context.lineWidth = Math.max(2, sample.source.width / 900);
      context.strokeStyle = "#1c6b62";
      context.fillStyle = "rgba(28, 107, 98, 0.08)";
      context.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
      context.strokeRect(bounds.left, bounds.top, bounds.width, bounds.height);
      context.restore();
    }

    if (showPose) {
      context.save();
      context.fillStyle = "#1c6b62";
      context.strokeStyle = "#ffffff";
      context.lineWidth = Math.max(2, sample.source.width / 1200);
      const dotRadius = Math.max(5, sample.source.width / 260);
      sample.keypoints
        .filter((point) => point.confidence > 0.05)
        .forEach((point) => {
          context.beginPath();
          context.arc(point.x, point.y, dotRadius, 0, Math.PI * 2);
          context.fill();
          context.stroke();
        });
      context.restore();
    }

    const crop = cropRef.current;
    const cropLineWidth = Math.max(6, sample.source.width / 420);
    const cropInset = cropLineWidth / 2 + 1;
    const cropStroke = insetRect(crop, cropInset);
    context.save();
    context.fillStyle = "rgba(179, 58, 58, 0.14)";
    context.strokeStyle = "#d72d2d";
    context.lineWidth = cropLineWidth;
    context.lineJoin = "round";
    context.shadowColor = "rgba(0, 0, 0, 0.45)";
    context.shadowBlur = Math.max(8, sample.source.width / 180);
    context.shadowOffsetY = Math.max(2, sample.source.width / 900);
    context.fillRect(crop.left, crop.top, crop.width, crop.height);
    context.strokeRect(cropStroke.left, cropStroke.top, cropStroke.width, cropStroke.height);
    context.shadowColor = "transparent";
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.lineWidth = Math.max(2, sample.source.width / 1100);
    context.strokeRect(cropStroke.left, cropStroke.top, cropStroke.width, cropStroke.height);
    drawHandles(context, crop, sample.source.width, sample.source.height);
    context.restore();
  };

  const scheduleDraw = () => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      drawCanvas();
    });
  };

  const redrawNow = () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    drawCanvas();
  };

  useEffect(() => {
    cropRef.current = sample.crop;
    scheduleDraw();
  }, [sample.crop]);

  useEffect(() => {
    scheduleDraw();
  }, [showPose]);

  useEffect(() => {
    const image = new Image();
    image.onload = drawCanvas;
    image.src = sample.previewUrl;
    imageRef.current = image;
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [sample.previewUrl, sample.source.width, sample.source.height]);

  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * sample.source.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * sample.source.height)
    };
  };

  const startDraw = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = pointFromEvent(event);
    const currentCrop = cropRef.current;
    const handle = hitResizeHandle(point, currentCrop, sample.source.width, sample.source.height);
    if (handle) {
      dragStateRef.current = {
        mode: "resize",
        handle,
        origin: { ...currentCrop }
      };
    } else if (isPointInsideCrop(point, currentCrop)) {
      dragStateRef.current = {
        mode: "move",
        offsetX: point.x - currentCrop.left,
        offsetY: point.y - currentCrop.top
      };
    } else {
      dragStateRef.current = { mode: "draw", start: point };
      cropRef.current = { left: point.x, top: point.y, width: 1, height: 1 };
      redrawNow();
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateDraw = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const dragState = dragStateRef.current;
    const point = pointFromEvent(event);
    if (!dragState) {
      event.currentTarget.style.cursor = cursorForPoint(point, cropRef.current, sample.source.width, sample.source.height);
      return;
    }

    if (dragState.mode === "move") {
      cropRef.current = clampCrop(
        {
          ...cropRef.current,
          left: point.x - dragState.offsetX,
          top: point.y - dragState.offsetY
        },
        sample.source.width,
        sample.source.height
      );
    } else if (dragState.mode === "resize") {
      cropRef.current = resizeCropFromHandle(
        dragState.origin,
        dragState.handle,
        point,
        aspectRatio,
        sample.source.width,
        sample.source.height
      );
    } else {
      cropRef.current = normalizeAspectCrop(
        dragState.start,
        point,
        aspectRatio,
        sample.source.width,
        sample.source.height
      );
    }
    redrawNow();
  };

  const finishDraw = (event?: PointerEvent<HTMLCanvasElement>) => {
    if (!dragStateRef.current) return;
    event?.preventDefault();
    dragStateRef.current = null;
    onUpdate(sample.id, { crop: cropRef.current });
  };

  const updateCrop = (patch: Partial<TrainingSample["crop"]>) => {
    const next = { ...cropRef.current, ...patch };
    if (patch.width !== undefined) {
      next.height = patch.width / aspectRatio;
    }
    if (patch.height !== undefined) {
      next.width = patch.height * aspectRatio;
    }
    cropRef.current = clampCrop(next, sample.source.width, sample.source.height);
    scheduleDraw();
    onUpdate(sample.id, { crop: cropRef.current });
  };

  return (
    <article className="calibration-card">
      <div className="training-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="training-canvas"
          width={sample.source.width}
          height={sample.source.height}
          role="img"
          aria-label={`${sample.filename} crop editor`}
          onPointerDown={startDraw}
          onPointerMove={updateDraw}
          onPointerUp={finishDraw}
          onPointerCancel={finishDraw}
        />
      </div>
      <div className="calibration-fields">
        <strong>{sample.filename}</strong>
        <span>
          {sample.source.width}x{sample.source.height} · pose conf {sample.confidence.toFixed(2)} · crop{" "}
          {Math.round(sample.crop.width)}x{Math.round(sample.crop.height)} · ratio {aspectRatio.toFixed(3)}
        </span>
        <div className={`pose-provider-pill ${sample.poseProvider ?? "unknown"}`}>
          姿态引擎：{providerLabel(sample.poseProvider)}
        </div>
        <button type="button" className="pose-toggle" onClick={() => setShowPose((visible) => !visible)}>
          {showPose ? <EyeOff size={16} /> : <Eye size={16} />}
          <span>{showPose ? "隐藏 OpenPose" : "显示 OpenPose"}</span>
        </button>
        <div className="sample-set-switch" aria-label="样本用途">
          <button
            type="button"
            className={sample.set === "train" ? "active" : ""}
            onClick={() => onUpdate(sample.id, { set: "train" })}
          >
            训练集
          </button>
          <button
            type="button"
            className={sample.set === "test" ? "active" : ""}
            onClick={() => onUpdate(sample.id, { set: "test" })}
          >
            测试集
          </button>
        </div>
        <div className="crop-action-row">
          <button type="button" className="preview-crop-button" onClick={() => onPreview(sample)}>
            <ScanSearch size={16} />
            <span>预览裁切</span>
          </button>
          <button
            type="button"
            className={`confirm-crop-button ${sample.confirmed ? "confirmed" : ""}`}
            onClick={() => onConfirm(sample)}
            disabled={!sample.cropPreviewUrl && !sample.confirmed}
          >
          <Check size={16} />
            <span>{sample.confirmed ? "已确认" : "确认样本"}</span>
          </button>
        </div>
        {sample.cropPreviewUrl && (
          <div className="crop-preview">
            <img src={sample.cropPreviewUrl} alt={`${sample.filename} crop preview`} />
          </div>
        )}
        <div className="grid-two">
          <NumberField label="裁切 X" value={Math.round(sample.crop.left)} onChange={(left) => updateCrop({ left })} />
          <NumberField label="裁切 Y" value={Math.round(sample.crop.top)} onChange={(top) => updateCrop({ top })} />
          <NumberField label="裁切宽" value={Math.round(sample.crop.width)} onChange={(width) => updateCrop({ width })} />
          <NumberField label="裁切高" value={Math.round(sample.crop.height)} onChange={(height) => updateCrop({ height })} />
        </div>
      </div>
    </article>
  );
}

function resizeCropFromHandle(
  origin: TrainingSample["crop"],
  handle: ResizeHandle,
  point: { x: number; y: number },
  aspectRatio: number,
  imageWidth: number,
  imageHeight: number
) {
  const right = origin.left + origin.width;
  const bottom = origin.top + origin.height;
  const centerX = origin.left + origin.width / 2;
  const centerY = origin.top + origin.height / 2;
  const minWidth = 24 * aspectRatio;

  let width = origin.width;
  let height = origin.height;
  let left = origin.left;
  let top = origin.top;

  if (handle === "e" || handle === "w") {
    width = Math.max(minWidth, handle === "e" ? point.x - origin.left : right - point.x);
    height = width / aspectRatio;
    left = handle === "e" ? origin.left : right - width;
    top = centerY - height / 2;
  } else if (handle === "s" || handle === "n") {
    height = Math.max(24, handle === "s" ? point.y - origin.top : bottom - point.y);
    width = height * aspectRatio;
    left = centerX - width / 2;
    top = handle === "s" ? origin.top : bottom - height;
  } else {
    const fixed = {
      x: handle.includes("w") ? right : origin.left,
      y: handle.includes("n") ? bottom : origin.top
    };
    width = Math.max(minWidth, Math.abs(point.x - fixed.x), Math.abs(point.y - fixed.y) * aspectRatio);
    height = width / aspectRatio;
    left = handle.includes("e") ? fixed.x : fixed.x - width;
    top = handle.includes("s") ? fixed.y : fixed.y - height;
  }

  return clampCrop({ left, top, width, height }, imageWidth, imageHeight);
}

function drawHandles(
  context: CanvasRenderingContext2D,
  crop: TrainingSample["crop"],
  imageWidth: number,
  imageHeight: number
) {
  const size = Math.max(24, imageWidth / 68);
  const handles = cropHandles(crop, size / 2 + 2, imageWidth, imageHeight);
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#d72d2d";
  context.lineWidth = Math.max(4, imageWidth / 520);
  context.shadowColor = "rgba(0, 0, 0, 0.42)";
  context.shadowBlur = Math.max(6, imageWidth / 220);
  handles.forEach((handle) => {
    context.beginPath();
    context.roundRect(handle.x - size / 2, handle.y - size / 2, size, size, size * 0.22);
    context.fill();
    context.stroke();
  });
}

function hitResizeHandle(
  point: { x: number; y: number },
  crop: TrainingSample["crop"],
  imageWidth: number,
  imageHeight: number
) {
  const hitSize = Math.max(28, imageWidth / 70);
  return (
    cropHandles(crop, hitSize / 2, imageWidth, imageHeight).find(
      (handle) => Math.abs(point.x - handle.x) <= hitSize / 2 && Math.abs(point.y - handle.y) <= hitSize / 2
    )?.id ?? null
  );
}

function cursorForPoint(
  point: { x: number; y: number },
  crop: TrainingSample["crop"],
  imageWidth: number,
  imageHeight: number
) {
  const handle = hitResizeHandle(point, crop, imageWidth, imageHeight);
  if (handle === "n" || handle === "s") return "ns-resize";
  if (handle === "e" || handle === "w") return "ew-resize";
  if (handle === "ne" || handle === "sw") return "nesw-resize";
  if (handle === "nw" || handle === "se") return "nwse-resize";
  if (isPointInsideCrop(point, crop)) return "grab";
  return "crosshair";
}

function cropHandles(
  crop: TrainingSample["crop"],
  padding = 0,
  imageWidth = Number.POSITIVE_INFINITY,
  imageHeight = Number.POSITIVE_INFINITY
): Array<{ id: ResizeHandle; x: number; y: number }> {
  const left = crop.left;
  const top = crop.top;
  const right = crop.left + crop.width;
  const bottom = crop.top + crop.height;
  const centerX = crop.left + crop.width / 2;
  const centerY = crop.top + crop.height / 2;
  const handles: Array<{ id: ResizeHandle; x: number; y: number }> = [
    { id: "nw", x: left, y: top },
    { id: "n", x: centerX, y: top },
    { id: "ne", x: right, y: top },
    { id: "e", x: right, y: centerY },
    { id: "se", x: right, y: bottom },
    { id: "s", x: centerX, y: bottom },
    { id: "sw", x: left, y: bottom },
    { id: "w", x: left, y: centerY }
  ];
  return handles.map((handle) => ({
    ...handle,
    x: clampValue(handle.x, padding, imageWidth - padding),
    y: clampValue(handle.y, padding, imageHeight - padding)
  }));
}

function insetRect(crop: TrainingSample["crop"], inset: number) {
  const safeInset = Math.min(inset, crop.width / 2 - 0.5, crop.height / 2 - 0.5);
  return {
    left: crop.left + safeInset,
    top: crop.top + safeInset,
    width: Math.max(1, crop.width - safeInset * 2),
    height: Math.max(1, crop.height - safeInset * 2)
  };
}

function clampValue(value: number, min: number, max: number) {
  if (max < min) return value;
  return Math.max(min, Math.min(value, max));
}

function providerLabel(provider: TrainingSample["poseProvider"]) {
  if (provider === "rtmw") return "RTMW-l ONNX";
  if (provider === "heuristic") return "旧方案 / Heuristic";
  return "未知 / 旧数据";
}
