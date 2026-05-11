import { useMemo, useRef, useState } from "react";
import { ImageUp, Play, RotateCcw } from "lucide-react";
import { viewAngleLabels } from "../constants";
import type { PoseAnalysis, PoseKeypoint, PoseProviderId, ViewAngle } from "../types";

type ViewTestPageProps = {
  poseProvider: PoseProviderId;
};

type PreviewImage = {
  file: File;
  url: string;
};

const viewTone: Record<ViewAngle, string> = {
  front: "front",
  side: "side",
  back: "back"
};

export function ViewTestPage({ poseProvider }: ViewTestPageProps) {
  const [previews, setPreviews] = useState<PreviewImage[]>([]);
  const [results, setResults] = useState<PoseAnalysis[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const activePreview = previews[activeIndex];
  const activeResult = results[activeIndex];
  const activeViewAngle = activeResult ? resolvedViewAngle(activeResult) : null;

  const selectedLabel = useMemo(() => {
    if (previews.length === 0) return "选择正面、侧面或背面图片";
    if (previews.length === 1) return previews[0].file.name;
    return `${previews.length} 张图片待识别`;
  }, [previews]);

  const chooseFiles = (selected: FileList | null) => {
    setError("");
    setResults([]);
    previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    const nextPreviews = Array.from(selected ?? []).map((file) => ({
      file,
      url: URL.createObjectURL(file)
    }));
    setPreviews(nextPreviews);
    setActiveIndex(0);
  };

  const analyzeViews = async () => {
    if (previews.length === 0) {
      setError("请先选择图片。");
      return;
    }

    setIsAnalyzing(true);
    setError("");
    try {
      const formData = new FormData();
      previews.forEach((preview) => formData.append("images", preview.file));
      formData.append("pose_provider", poseProvider);
      const response = await fetch("/api/analyze-poses", { method: "POST", body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "视角识别失败");
      }
      const body = (await response.json()) as { images: PoseAnalysis[] };
      setResults(body.images.map(normalizePoseAnalysis));
      setActiveIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "视角识别失败");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <section className="work-page view-test-page">
      <div className="control-panel">
        <div className="section-header">
          <div>
            <h2>视角测试</h2>
            <p>上传图片并识别正面、侧面、背面</p>
          </div>
        </div>
        <button className="upload-zone" type="button" onClick={() => inputRef.current?.click()}>
          <ImageUp size={22} />
          <span>{selectedLabel}</span>
        </button>
        <input
          ref={inputRef}
          hidden
          multiple
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => chooseFiles(event.target.files)}
        />
        <div className="toolbar">
          <button type="button" onClick={analyzeViews} disabled={isAnalyzing}>
            <Play size={17} />
            <span>{isAnalyzing ? "识别中" : "开始识别视角"}</span>
          </button>
          <button type="button" className="ghost" onClick={() => chooseFiles(null)}>
            <RotateCcw size={17} />
          </button>
        </div>
        <div className="summary-strip">
          <span>{previews.length} 张图片</span>
          <span>{results.length} 张已识别</span>
          <span>{providerLabel(poseProvider)}</span>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="file-list">
          {previews.map((preview, index) => (
            <button
              key={`${preview.file.name}-${preview.file.lastModified}`}
              type="button"
              className={activeIndex === index ? "active" : ""}
              onClick={() => setActiveIndex(index)}
            >
              <span>{preview.file.name}</span>
              <small className={results[index] ? `view-result-${resolvedViewAngle(results[index])}` : ""}>
                {results[index] ? `结论：${viewAngleLabels[resolvedViewAngle(results[index])]}` : `${Math.round(preview.file.size / 1024)} KB`}
              </small>
            </button>
          ))}
        </div>
      </div>

      <div className="main-stage view-test-stage">
        <div className="image-stage pose-preview-stage">
          {activePreview ? (
            <PosePreview previewUrl={activePreview.url} result={activeResult} />
          ) : (
            <div className="empty-state">选择图片后开始测试视角识别</div>
          )}
        </div>
        {activeResult && activeViewAngle && (
          <div className="result-panel view-test-result">
            <div>
              <span className={`view-angle-pill ${viewTone[activeViewAngle]}`}>
                {viewAngleLabels[activeViewAngle]}
              </span>
              <h2>{activeResult.filename ?? activePreview?.file.name}</h2>
              <p>
                原图 {activeResult.source.width}x{activeResult.source.height} · {activeResult.keypoints.length} 个节点
              </p>
            </div>
            <div className="view-metrics">
              <Metric label="脸部点" value={countVisible(activeResult, ["nose", "left_eye", "right_eye", "left_ear", "right_ear"])} />
              <Metric label="左侧身体点" value={countVisible(activeResult, ["left_shoulder", "left_elbow", "left_wrist", "left_hip", "left_knee", "left_ankle"])} />
              <Metric label="右侧身体点" value={countVisible(activeResult, ["right_shoulder", "right_elbow", "right_wrist", "right_hip", "right_knee", "right_ankle"])} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PosePreview({ previewUrl, result }: { previewUrl: string; result?: PoseAnalysis }) {
  const viewAngle = result ? resolvedViewAngle(result) : null;
  return (
    <div className="pose-preview-wrap">
      <img src={previewUrl} alt={result?.filename ?? "View test preview"} />
      {result && viewAngle && (
        <div className={`pose-conclusion ${viewTone[viewAngle]}`}>
          <strong>识别结论</strong>
          <span>{viewAngleLabels[viewAngle]}</span>
        </div>
      )}
      {result?.keypoints.map((point) => {
        if (point.confidence < 0.15) return null;
        return (
          <span
            className="pose-point"
            key={point.name}
            title={`${point.name} ${point.confidence.toFixed(2)}`}
            style={{
              left: `${(point.x / result.source.width) * 100}%`,
              top: `${(point.y / result.source.height) * 100}%`
            }}
          />
        );
      })}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="view-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function countVisible(result: PoseAnalysis, names: string[]) {
  return names.filter((name) => result.keypoints.some((point) => point.name === name && point.confidence >= 0.2)).length;
}

function normalizePoseAnalysis(result: PoseAnalysis): PoseAnalysis {
  return {
    ...result,
    viewAngle: result.viewAngle ?? classifyPoseView(result)
  };
}

function resolvedViewAngle(result: PoseAnalysis): ViewAngle {
  return result.viewAngle ?? classifyPoseView(result);
}

function classifyPoseView(result: PoseAnalysis): ViewAngle {
  const faceNames = ["nose", "left_eye", "right_eye", "left_ear", "right_ear"];
  const leftNames = ["left_shoulder", "left_elbow", "left_wrist", "left_hip", "left_knee", "left_ankle"];
  const rightNames = ["right_shoulder", "right_elbow", "right_wrist", "right_hip", "right_knee", "right_ankle"];
  const faceScore = averageConfidence(result, faceNames);
  const leftScore = averageConfidence(result, leftNames);
  const rightScore = averageConfidence(result, rightNames);
  const bodyScore = (leftScore + rightScore) / 2;
  const visibleFacePoints = countVisible(result, faceNames);

  if (bodyScore >= 0.15 && (faceScore < 0.16 || visibleFacePoints <= 1)) return "back";

  const sideImbalance = Math.abs(leftScore - rightScore) / Math.max(leftScore, rightScore, 0.01);
  if (sideImbalance >= 0.38) return "side";

  const leftShoulder = pointByName(result, "left_shoulder");
  const rightShoulder = pointByName(result, "right_shoulder");
  const leftHip = pointByName(result, "left_hip");
  const rightHip = pointByName(result, "right_hip");
  const nose = pointByName(result, "nose");
  if (leftShoulder && rightShoulder && leftHip && rightHip) {
    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
    const bodyHeight = Math.max(1, Math.abs((leftHip.y + rightHip.y) / 2 - (leftShoulder.y + rightShoulder.y) / 2));
    if (shoulderWidth / bodyHeight < 0.45 && faceScore >= 0.16) return "side";
    if (nose && nose.confidence >= 0.2 && shoulderWidth > 1) {
      const shoulderCenter = (leftShoulder.x + rightShoulder.x) / 2;
      if (Math.abs(nose.x - shoulderCenter) / shoulderWidth >= 0.22) return "side";
    }
  }

  return "front";
}

function averageConfidence(result: PoseAnalysis, names: string[]) {
  const points = names.map((name) => pointByName(result, name)).filter((point): point is NonNullable<typeof point> => Boolean(point));
  if (points.length === 0) return 0;
  return points.reduce((sum, point) => sum + Math.max(0, Math.min(1, point.confidence)), 0) / points.length;
}

function pointByName(result: PoseAnalysis, name: string): PoseKeypoint | undefined {
  if (name === "neck") {
    const left = pointByName(result, "left_shoulder");
    const right = pointByName(result, "right_shoulder");
    if (left && right) {
      return {
        name,
        x: (left.x + right.x) / 2,
        y: (left.y + right.y) / 2,
        confidence: Math.min(left.confidence, right.confidence)
      };
    }
  }
  return result.keypoints.find((point) => point.name === name);
}

function providerLabel(provider: PoseProviderId) {
  if (provider === "rtmw") return "RTMW-l";
  return "旧方案";
}
