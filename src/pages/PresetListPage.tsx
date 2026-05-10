import { useRef, useState } from "react";
import { Copy, FlaskConical, ImageUp, Pencil, Plus, Play, Trash2, X } from "lucide-react";
import type { CropPreset, PoseProviderId, ProcessResponse } from "../types";

type PresetListPageProps = {
  allTags: string[];
  presets: CropPreset[];
  onAdd: () => void;
  onDuplicate: (preset: CropPreset) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  poseProvider: PoseProviderId;
};

export function PresetListPage({ allTags, presets, onAdd, onDuplicate, onEdit, onRemove, poseProvider }: PresetListPageProps) {
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [testingPreset, setTestingPreset] = useState<CropPreset | null>(null);
  const visiblePresets = presets.filter((preset) => {
    const text = `${preset.name} ${preset.tags.join(" ")} ${preset.status ?? ""} ${preset.note ?? ""}`.toLowerCase();
    return text.includes(query.toLowerCase()) && activeTags.every((tag) => preset.tags.includes(tag));
  });

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <h2>预设管理</h2>
          <p>检索、筛选、测试和进入单个预设编辑</p>
        </div>
        <button type="button" onClick={onAdd}>
          <Plus size={17} />
          <span>新建预设</span>
        </button>
      </div>
      <div className="management-tools">
        <input value={query} placeholder="搜索名称、标签、状态或说明" onChange={(event) => setQuery(event.target.value)} />
        <div className="tag-filter">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={activeTags.includes(tag) ? "active" : ""}
              onClick={() =>
                setActiveTags((current) =>
                  current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
                )
              }
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="preset-table-shell">
        <table className="preset-data-table">
          <thead>
            <tr>
              <th>预设</th>
              <th>状态</th>
              <th>输出尺寸</th>
              <th>标签</th>
              <th>说明</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visiblePresets.map((preset) => (
              <tr key={preset.id}>
                <td>
                  <strong>{preset.name}</strong>
                  <span>{preset.id}</span>
                </td>
                <td>
                  <span className={`status-pill ${preset.status ?? "draft"}`}>{statusLabel(preset)}</span>
                </td>
                <td>
                  {preset.width}x{preset.height}
                </td>
                <td>
                  <div className="row-tags compact">
                    {preset.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className="table-note">{preset.note || "无说明"}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="icon-button" title="测试" onClick={() => setTestingPreset(preset)}>
                      <FlaskConical size={15} />
                    </button>
                    <button type="button" className="icon-button" title="编辑" onClick={() => onEdit(preset.id)}>
                      <Pencil size={15} />
                    </button>
                    <button type="button" className="icon-button" title="复制" onClick={() => onDuplicate(preset)}>
                      <Copy size={15} />
                    </button>
                    <button type="button" className="icon-button danger" title="删除" onClick={() => onRemove(preset.id)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visiblePresets.length === 0 && <div className="empty-state compact">没有匹配的预设</div>}
      </div>

      {testingPreset && <PresetTestPanel preset={testingPreset} poseProvider={poseProvider} onClose={() => setTestingPreset(null)} />}
    </section>
  );
}

function PresetTestPanel({
  preset,
  poseProvider,
  onClose
}: {
  preset: CropPreset;
  poseProvider: PoseProviderId;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [compareResults, setCompareResults] = useState<Record<string, ProcessResponse> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  const chooseFile = (selected: FileList | null) => {
    const nextFile = selected?.[0] ?? null;
    setFile(nextFile);
    setResult(null);
    setError("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : "");
  };

  const runTest = async () => {
    if (!file) {
      setError("请先上传测试图片。");
      return;
    }
    setIsProcessing(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("presets", JSON.stringify([preset]));
      formData.append("pose_provider", poseProvider);
      const response = await fetch("/api/process", { method: "POST", body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "测试失败");
      }
      setResult((await response.json()) as ProcessResponse);
      setCompareResults(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "测试失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const runCompare = async () => {
    if (!file) {
      setError("请先上传测试图片。");
      return;
    }
    setIsProcessing(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("presets", JSON.stringify([preset]));
      const response = await fetch("/api/process-compare", { method: "POST", body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "对比失败");
      }
      setCompareResults((await response.json()) as Record<string, ProcessResponse>);
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "对比失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const crop = result?.crops[0];

  return (
    <section className="preset-test-panel">
      <div className="page-header">
        <div>
          <h2>测试预设：{preset.name}</h2>
          <p>{preset.width}x{preset.height} · {statusLabel(preset)}</p>
        </div>
        <button type="button" className="back-button" onClick={onClose}>
          <X size={17} />
          <span>关闭</span>
        </button>
      </div>
      <div className="preset-test-grid">
        <div className="test-upload-panel">
          <button type="button" className="upload-zone" onClick={() => inputRef.current?.click()}>
            <ImageUp size={20} />
            <span>{file ? file.name : "上传一张测试图片"}</span>
          </button>
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => chooseFile(event.target.files)}
          />
          <button type="button" className="calibrate-button ready" onClick={runTest} disabled={isProcessing}>
            <Play size={17} />
            <span>{isProcessing ? "测试中" : `运行测试：${providerLabel(poseProvider)}`}</span>
          </button>
          <button type="button" className="preview-crop-button" onClick={runCompare} disabled={isProcessing}>
            <FlaskConical size={17} />
            <span>对比两种方案</span>
          </button>
          {error && <p className="error">{error}</p>}
          {previewUrl && <img className="test-source-preview" src={previewUrl} alt="测试原图" />}
        </div>
        <div className="test-result-panel">
          {compareResults ? (
            <div className="compare-result-grid">
              {Object.entries(compareResults).map(([provider, response]) => {
                const compareCrop = response.crops[0];
                return (
                  <article className="compare-result-card" key={provider}>
                    <strong>{providerLabel(provider as PoseProviderId)}</strong>
                    {compareCrop && <img src={`data:image/png;base64,${compareCrop.image}`} alt={provider} />}
                    {compareCrop && (
                      <span>
                        输出 {compareCrop.width}x{compareCrop.height} · BBox L{compareCrop.box.left} T{compareCrop.box.top}
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
          ) : crop ? (
            <>
              <img src={`data:image/png;base64,${crop.image}`} alt={crop.name} />
              <div className="test-result-meta">
                <strong>{crop.name}</strong>
                <span>
                  原图 {result?.source.width}x{result?.source.height} · 输出 {crop.width}x{crop.height}
                </span>
                <span>
                  BBox L{crop.box.left} T{crop.box.top} R{crop.box.right} B{crop.box.bottom}
                </span>
              </div>
            </>
          ) : (
            <div className="empty-state">运行测试后查看裁切结果</div>
          )}
        </div>
      </div>
    </section>
  );
}

function statusLabel(preset: CropPreset) {
  if (preset.status === "ready") return "正式策略";
  if (preset.status === "incomplete") return "残缺策略";
  return "草稿";
}

function providerLabel(provider: PoseProviderId | string) {
  return provider === "heuristic" ? "旧方案" : "RTMW-l";
}
