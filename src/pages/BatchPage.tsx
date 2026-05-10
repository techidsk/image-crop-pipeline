import { useMemo, useRef, useState } from "react";
import { ImageUp, Play, RotateCcw } from "lucide-react";
import { CropCard } from "../components/CropCard";
import { ResultOverview } from "../components/ResultOverview";
import type { CropPreset, PoseProviderId, ProcessResponse } from "../types";

type BatchPageProps = {
  allTags: string[];
  activeTags: string[];
  presets: CropPreset[];
  poseProvider: PoseProviderId;
  onToggleTag: (tag: string) => void;
};

export function BatchPage({ allTags, activeTags, presets, poseProvider, onToggleTag }: BatchPageProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [results, setResults] = useState<ProcessResponse[]>([]);
  const [activeResult, setActiveResult] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = useMemo(() => {
    if (files.length === 0) return "选择一张或多张图片";
    if (files.length === 1) return files[0].name;
    return `${files.length} 张图片待处理`;
  }, [files]);

  const chooseFiles = (selected: FileList | null) => {
    setError("");
    setResults([]);
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    const nextFiles = Array.from(selected ?? []);
    setFiles(nextFiles);
    setPreviewUrls(nextFiles.map((file) => URL.createObjectURL(file)));
  };

  const processImages = async () => {
    if (files.length === 0) {
      setError("请先选择图片。");
      return;
    }
    if (presets.length === 0) {
      setError("当前标签筛选下没有可用预设。");
      return;
    }

    setIsProcessing(true);
    setError("");
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("images", file));
      formData.append("presets", JSON.stringify(presets));
      formData.append("pose_provider", poseProvider);
      const response = await fetch("/api/process-batch", { method: "POST", body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "处理失败");
      }
      const body = (await response.json()) as { images: ProcessResponse[] };
      setResults(body.images);
      setActiveResult(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "处理失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const active = results[activeResult];

  return (
    <section className="work-page">
      <div className="control-panel">
        <div className="section-header">
          <div>
            <h2>批量处理</h2>
            <p>按标签筛选预设，再批量生成输出</p>
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
          <button type="button" onClick={processImages} disabled={isProcessing}>
            <Play size={17} />
            <span>{isProcessing ? "处理中" : "批量识别并裁切"}</span>
          </button>
          <button type="button" className="ghost" onClick={() => chooseFiles(null)}>
            <RotateCcw size={17} />
          </button>
        </div>
        <div className="summary-strip">
          <span>{files.length} 张图片</span>
          <span>{presets.length} 个预设</span>
          <span>{files.length * presets.length} 张输出</span>
        </div>
        <div className="tag-filter">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={activeTags.includes(tag) ? "active" : ""}
              onClick={() => onToggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="file-list">
          {files.map((file, index) => (
            <button
              key={`${file.name}-${file.lastModified}`}
              type="button"
              className={activeResult === index ? "active" : ""}
              onClick={() => setActiveResult(index)}
            >
              <span>{file.name}</span>
              <small>{Math.round(file.size / 1024)} KB</small>
            </button>
          ))}
        </div>
      </div>

      <div className="main-stage">
        <div className="image-stage">
          {active ? (
            <ResultOverview result={active} />
          ) : previewUrls[0] ? (
            <img src={previewUrls[0]} alt="Source preview" />
          ) : (
            <div className="empty-state">选择图片后开始批量裁切</div>
          )}
        </div>
        {results.length > 0 && (
          <div className="result-panel">
            <div className="result-header">
              <h2>
                {results.length} 张图片完成 · {results.reduce((sum, item) => sum + item.crops.length, 0)} 张输出
              </h2>
              <span>当前：{active?.filename ?? "未选择"}</span>
            </div>
            <div className="crop-grid">
              {results.flatMap((result) =>
                result.crops.map((crop) => (
                  <CropCard
                    key={`${result.filename}-${crop.presetId}`}
                    filename={result.filename ?? "image"}
                    crop={crop}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
