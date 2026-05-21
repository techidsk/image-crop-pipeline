import { useRef, useState } from "react";
import { Archive, ArchiveRestore, Copy, FlaskConical, ImageUp, Pencil, Plus, Play, X } from "lucide-react";
import { viewAngleLabels } from "../constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CropPreset, PoseProviderId, PresetStatus, ProcessResponse } from "../types";

const STATUS_META: Record<PresetStatus, { label: string; badge: string }> = {
  draft: { label: "草稿", badge: "border-slate-200 bg-slate-100 text-slate-600" },
  incomplete: { label: "残缺策略", badge: "border-amber-200 bg-amber-50 text-amber-700" },
  ready: { label: "正式策略", badge: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  archived: { label: "已停用", badge: "border-rose-200 bg-rose-50 text-rose-600" }
};

const STATUS_FILTERS: PresetStatus[] = ["draft", "incomplete", "ready", "archived"];

type StatusFilter = PresetStatus | "all";

type PresetListPageProps = {
  allTags: string[];
  presets: CropPreset[];
  onAdd: () => void;
  onDuplicate: (preset: CropPreset) => void;
  onEdit: (id: string) => void;
  onSetStatus: (id: string, status: PresetStatus) => void;
  poseProvider: PoseProviderId;
};

export function PresetListPage({ allTags, presets, onAdd, onDuplicate, onEdit, onSetStatus, poseProvider }: PresetListPageProps) {
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [testingPreset, setTestingPreset] = useState<CropPreset | null>(null);
  const visiblePresets = presets.filter((preset) => {
    const status = preset.status ?? "draft";
    if (statusFilter !== "all" && status !== statusFilter) return false;
    return activeTags.every((tag) => preset.tags.includes(tag));
  });

  return (
    <section className="flex min-h-[calc(100vh-32px)] flex-col gap-4 rounded-lg border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-ink">预设管理</h2>
          <p className="text-xs text-muted">筛选、测试和进入单个预设编辑</p>
        </div>
        <Button type="button" onClick={onAdd}>
          <Plus />
          <span>新建预设</span>
        </Button>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted">状态</span>
          <Button
            type="button"
            size="sm"
            variant={statusFilter === "all" ? "default" : "outline"}
            onClick={() => setStatusFilter("all")}
          >
            全部
          </Button>
          {STATUS_FILTERS.map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={statusFilter === status ? "default" : "outline"}
              onClick={() => setStatusFilter(status)}
            >
              {STATUS_META[status].label}
            </Button>
          ))}
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted">标签</span>
            {allTags.map((tag) => (
              <Button
                key={tag}
                type="button"
                size="sm"
                variant={activeTags.includes(tag) ? "default" : "outline"}
                onClick={() =>
                  setActiveTags((current) =>
                    current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
                  )
                }
              >
                {tag}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-[#f4f7f9] text-xs font-bold text-[#52606f]">
              <th className="px-3.5 py-3 text-left">预设</th>
              <th className="px-3.5 py-3 text-left">状态</th>
              <th className="px-3.5 py-3 text-left">适用视角</th>
              <th className="px-3.5 py-3 text-left">输出尺寸</th>
              <th className="px-3.5 py-3 text-left">标签</th>
              <th className="px-3.5 py-3 text-left">说明</th>
              <th className="px-3.5 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {visiblePresets.map((preset) => {
              const status = preset.status ?? "draft";
              const archived = status === "archived";
              return (
                <tr
                  key={preset.id}
                  className={cn("border-t border-[#edf0f3] text-[13px] text-[#3a4654]", archived && "opacity-55")}
                >
                  <td className="px-3.5 py-3 align-middle">
                    <div className="flex flex-col">
                      <strong className="font-semibold text-ink">{preset.name}</strong>
                      <span className="text-xs text-muted">{preset.id}</span>
                    </div>
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <Badge variant="outline" className={STATUS_META[status].badge}>
                      {STATUS_META[status].label}
                    </Badge>
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <Badge variant="outline" className="border-[#d6ded7] bg-[#f2f7f5] text-[#2f5f58]">
                      {viewAngleText(preset)}
                    </Badge>
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    {preset.width}x{preset.height}
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <div className="flex flex-wrap gap-1.5">
                      {preset.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <span className="block max-w-[280px] truncate text-xs text-muted">{preset.note || "无说明"}</span>
                  </td>
                  <td className="px-3.5 py-3 align-middle">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="测试"
                        onClick={() => setTestingPreset(preset)}
                      >
                        <FlaskConical />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" title="编辑" onClick={() => onEdit(preset.id)}>
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="复制"
                        onClick={() => onDuplicate(preset)}
                      >
                        <Copy />
                      </Button>
                      {archived ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="恢复为草稿"
                          onClick={() => onSetStatus(preset.id, "draft")}
                        >
                          <ArchiveRestore />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="停用"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onSetStatus(preset.id, "archived")}
                        >
                          <Archive />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visiblePresets.length === 0 && (
          <div className="px-3.5 py-10 text-center text-sm text-muted">没有匹配的预设</div>
        )}
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
          <p>{preset.width}x{preset.height} · {viewAngleText(preset)} · {statusLabel(preset)}</p>
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

function viewAngleText(preset: CropPreset) {
  const angles = preset.viewAngles?.length ? preset.viewAngles : [preset.orientation ?? "front"];
  return angles.map((viewAngle) => viewAngleLabels[viewAngle]).join(" / ");
}

function statusLabel(preset: CropPreset) {
  return STATUS_META[preset.status ?? "draft"].label;
}

function providerLabel(provider: PoseProviderId | string) {
  return provider === "heuristic" ? "旧方案" : "RTMW-l";
}
