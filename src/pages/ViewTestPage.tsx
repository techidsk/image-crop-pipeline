import { useMemo, useRef, useState } from "react";
import { ImageUp, Play, RotateCcw } from "lucide-react";
import { viewAngleLabels } from "../constants";
import type { PoseAnalysis, PoseProviderId, ViewAngle } from "../types";

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
      setResults(body.images);
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
              <small className={results[index] ? `view-result-${results[index].viewAngle}` : ""}>
                {results[index] ? `结论：${viewAngleLabels[results[index].viewAngle]}` : `${Math.round(preview.file.size / 1024)} KB`}
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
        {activeResult && (
          <div className="result-panel view-test-result">
            <div>
              <span className={`view-angle-pill ${viewTone[activeResult.viewAngle]}`}>
                {viewAngleLabels[activeResult.viewAngle]}
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
  return (
    <div className="pose-preview-wrap">
      <img src={previewUrl} alt={result?.filename ?? "View test preview"} />
      {result && (
        <div className={`pose-conclusion ${viewTone[result.viewAngle]}`}>
          <strong>识别结论</strong>
          <span>{viewAngleLabels[result.viewAngle]}</span>
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

function providerLabel(provider: PoseProviderId) {
  if (provider === "rtmw") return "RTMW-l";
  return "旧方案";
}
