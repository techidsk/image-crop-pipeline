import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ImageUp, RefreshCw, Save, Wand2 } from "lucide-react";
import { viewAngleLabels } from "../constants";
import { NumberField } from "../components/NumberField";
import { TrainingCard } from "../components/TrainingCard";
import type { CropPreset, LearnedComposition, PoseProviderId, TrainingSample, ViewAngle } from "../types";
import {
  compositionForSample,
  filterModels,
  fitAspectCropAround,
  median,
  parseTags,
  personBounds,
  round4,
  semanticAnchorLabel,
  summarizeSemanticComposition
} from "../utils/cropTraining";

type ModelWithSample = LearnedComposition & {
  sampleId: string;
  filename: string;
  outputWidth: number;
  outputHeight: number;
};

type TrainingDiagnostics = {
  threshold: number;
  center: LearnedComposition | null;
  rows: Array<{
    sampleId: string;
    filename: string;
    distance: number;
    kept: boolean;
    model: ModelWithSample;
  }>;
  testRows: Array<{
    sampleId: string;
    filename: string;
    iou: number;
    centerError: number;
  }>;
};

type PresetEditorPageProps = {
  preset: CropPreset;
  poseProvider: PoseProviderId;
  onBack: () => void;
  onUpdate: (id: string, patch: Partial<CropPreset>) => void;
};

export function PresetEditorPage({ preset, poseProvider, onBack, onUpdate }: PresetEditorPageProps) {
  const [samples, setSamples] = useState<TrainingSample[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [trainingMessage, setTrainingMessage] = useState("");
  const [diagnostics, setDiagnostics] = useState<TrainingDiagnostics | null>(null);
  const trainingInputRef = useRef<HTMLInputElement>(null);
  const confirmedSamples = samples.filter((sample) => sample.confirmed);
  const trainSamples = confirmedSamples.filter((sample) => sample.set === "train");
  const testSamples = confirmedSamples.filter((sample) => sample.set === "test");
  const selectedSample = samples.find((sample) => sample.id === selectedSampleId) ?? samples[0];
  const activeViewAngles = preset.viewAngles?.length ? preset.viewAngles : viewAngles;

  useEffect(() => {
    void loadSavedSamples();
  }, [preset.id]);

  const loadSavedSamples = async () => {
    setTrainingMessage("");
    try {
      const response = await fetch(`/api/presets/${encodeURIComponent(preset.id)}/training-samples`);
      if (!response.ok) throw new Error("训练样本加载失败");
      const body = (await response.json()) as { samples: TrainingSample[] };
      const loaded = normalizeSamples(body.samples);
      setSamples(loaded);
      setSelectedSampleId(loaded[0]?.id ?? "");
      setDiagnostics(null);
    } catch (err) {
      setTrainingMessage(err instanceof Error ? err.message : "训练样本加载失败");
    }
  };

  const persistSamples = async (nextSamples: TrainingSample[]) => {
    const response = await fetch(`/api/presets/${encodeURIComponent(preset.id)}/training-samples`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(samplesForStorage(nextSamples))
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail ?? "训练样本保存失败");
    }
  };

  const loadTrainingSamples = async (selected: FileList | null) => {
    const files = Array.from(selected ?? []);
    if (files.length === 0) return;

    setIsAnalyzing(true);
    setTrainingMessage("");
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("images", file));
      formData.append("pose_provider", poseProvider);
      const response = await fetch(`/api/presets/${encodeURIComponent(preset.id)}/training-samples`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "样本上传失败");
      }
      const body = (await response.json()) as { samples: TrainingSample[] };
      const nextSamples = normalizeSamples(body.samples).map((sample) => {
        const bounds = personBounds(sample.keypoints);
        const crop = fitAspectCropAround(
          bounds?.centerX ?? sample.source.width / 2,
          bounds?.centerY ?? sample.source.height / 2,
          sample.source.width * 0.72,
          preset.width / preset.height,
          sample.source.width,
          sample.source.height
        );
        return sample.confirmed
          ? sample
          : {
              ...sample,
          crop,
              confidence: bounds?.confidence ?? sample.confidence,
              cropPreviewUrl: null
            };
      });
      setSamples(nextSamples);
      void persistSamples(nextSamples).catch((err) =>
        setTrainingMessage(err instanceof Error ? err.message : "训练样本保存失败")
      );
      setSelectedSampleId((current) => current || nextSamples[0]?.id || "");
    } catch (err) {
      setTrainingMessage(err instanceof Error ? err.message : "样本上传失败");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const reanalyzeUnknownSamples = async () => {
    setIsAnalyzing(true);
    setTrainingMessage("");
    try {
      const formData = new FormData();
      formData.append("pose_provider", poseProvider);
      formData.append("only_unknown", "true");
      const response = await fetch(`/api/presets/${encodeURIComponent(preset.id)}/training-samples/reanalyze`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "样本重新识别失败");
      }
      const body = (await response.json()) as { samples: TrainingSample[] };
      const nextSamples = normalizeSamples(body.samples);
      setSamples(nextSamples);
      setSelectedSampleId((current) => current || nextSamples[0]?.id || "");
      setTrainingMessage(`已使用 ${providerLabel(poseProvider)} 重新识别未知来源样本。`);
    } catch (err) {
      setTrainingMessage(err instanceof Error ? err.message : "样本重新识别失败");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateSample = (id: string, patch: Partial<TrainingSample>) => {
    setSamples((current) => {
      const nextSamples = current.map((sample) =>
        sample.id === id
          ? {
              ...sample,
              ...patch,
              ...(patch.crop ? { confirmed: false, cropPreviewUrl: null } : {})
            }
          : sample
      );
      void persistSamples(nextSamples).catch((err) =>
        setTrainingMessage(err instanceof Error ? err.message : "训练样本保存失败")
      );
      return nextSamples;
    });
  };

  const previewSample = async (sample: TrainingSample) => {
    try {
      const cropPreviewUrl = await renderCropPreview(sample);
      setSamples((current) => current.map((item) => (item.id === sample.id ? { ...item, cropPreviewUrl } : item)));
      setTrainingMessage("");
    } catch (err) {
      setTrainingMessage(err instanceof Error ? err.message : "裁切预览生成失败");
    }
  };

  const confirmSample = async (sample: TrainingSample) => {
    if (!sample.cropPreviewUrl) {
      await previewSample(sample);
    }
    setSamples((current) => {
      const nextSamples = current.map((item) => (item.id === sample.id ? { ...item, confirmed: true } : item));
      void persistSamples(nextSamples).catch((err) =>
        setTrainingMessage(err instanceof Error ? err.message : "训练样本保存失败")
      );
      return nextSamples;
    });
    setTrainingMessage("");
  };

  const saveIncompletePreset = () => {
    if (trainSamples.length === 0) {
      setTrainingMessage("至少需要确认 1 组训练样本，才能保存残缺策略。");
      return;
    }
    const models = makeTrainingModels(trainSamples);
    if (models.length === 0) {
      setTrainingMessage("当前训练样本缺少有效 OpenPose 人体范围，无法保存策略。");
      return;
    }
    const filtered = filterModels(models);
    const usable = filtered.kept.length > 0 ? filtered.kept : models;
    setDiagnostics({
      threshold: filtered.threshold,
      center: filtered.center,
      rows: filtered.diagnostics.map((item) => ({
        sampleId: item.model.sampleId,
        filename: item.model.filename,
        distance: item.distance,
        kept: item.kept,
        model: item.model
      })),
      testRows: makeTestDiagnostics(testSamples, usable)
    });
    savePresetComposition(usable, {
      status: "incomplete",
      note: `样本不足：当前仅 ${trainSamples.length} 组训练样本。可以用于预览效果，但建议补足至少 5 组后再作为正式预设。`
    });
    setTrainingMessage(`已保存为残缺策略：使用 ${usable.length}/${trainSamples.length} 组训练样本。`);
  };

  const trainPreset = () => {
    if (trainSamples.length < 5) {
      setTrainingMessage("至少需要确认 5 组训练样本。");
      return;
    }
    const models = makeTrainingModels(trainSamples);
    const filtered = filterModels(models);
    setDiagnostics({
      threshold: filtered.threshold,
      center: filtered.center,
      rows: filtered.diagnostics.map((item) => ({
        sampleId: item.model.sampleId,
        filename: item.model.filename,
        distance: item.distance,
        kept: item.kept,
        model: item.model
      })),
      testRows: makeTestDiagnostics(testSamples, filtered.kept)
    });
    if (filtered.kept.length < 5) {
      setTrainingMessage(
        `过滤偏差后不足 5 组：训练样本 ${trainSamples.length} 组，保留 ${filtered.kept.length} 组，过滤 ${trainSamples.length - filtered.kept.length} 组。`
      );
      return;
    }
    savePresetComposition(filtered.kept, {
      status: "ready",
      note: `训练完成：使用 ${filtered.kept.length}/${trainSamples.length} 组训练样本，过滤 ${trainSamples.length - filtered.kept.length} 组偏差样本。`
    });
    setTrainingMessage(
      `已生成构图策略：训练使用 ${filtered.kept.length}/${trainSamples.length} 组，过滤 ${trainSamples.length - filtered.kept.length} 组偏差样本，测试集 ${testSamples.length} 组。`
    );
  };

  const savePresetComposition = (
    models: ModelWithSample[],
    meta: Pick<CropPreset, "status" | "note">
  ) => {
    const semanticComposition = summarizeSemanticComposition(models);
    onUpdate(preset.id, {
      strategy: semanticComposition ? "pose_semantic_composition" : "learned_composition",
      composition: semanticComposition ?? {
        mode: "bbox",
        left: round4(median(models.map((item) => item.left))),
        top: round4(median(models.map((item) => item.top))),
        width: round4(median(models.map((item) => item.width))),
        height: round4(median(models.map((item) => item.height))),
        explanation: "人体外接框比例"
      },
      ...meta
    });
  };

  const toggleViewAngle = (viewAngle: ViewAngle, checked: boolean) => {
    const nextAngles = checked
      ? Array.from(new Set([...activeViewAngles, viewAngle]))
      : activeViewAngles.filter((item) => item !== viewAngle);
    onUpdate(preset.id, { viewAngles: nextAngles.length > 0 ? nextAngles : activeViewAngles });
  };

  return (
    <section className="editor-page">
      <div className="page-header">
        <button type="button" className="back-button" onClick={onBack}>
          <ChevronLeft size={17} />
          <span>返回</span>
        </button>
        <div>
          <h2>{preset.name}</h2>
          <p>编辑元数据、裁切参数和训练策略</p>
        </div>
      </div>
      <div className="editor-grid">
        <section className="editor-card">
          <h2>基础信息</h2>
          <label>
            名称
            <input value={preset.name} onChange={(event) => onUpdate(preset.id, { name: event.target.value })} />
          </label>
          <label>
            标签
            <input
              value={preset.tags.join(", ")}
              placeholder="portrait, product, square"
              onChange={(event) => onUpdate(preset.id, { tags: parseTags(event.target.value) })}
            />
          </label>
          <label>
            状态说明
            <textarea
              value={preset.note ?? ""}
              placeholder="这里会记录样本不足、训练完成等状态说明"
              onChange={(event) => onUpdate(preset.id, { note: event.target.value })}
            />
          </label>
          <div className="grid-two">
            <NumberField label="宽" value={preset.width} onChange={(width) => onUpdate(preset.id, { width })} />
            <NumberField label="高" value={preset.height} onChange={(height) => onUpdate(preset.id, { height })} />
          </div>
          <div className="crop-guard-options" aria-label="裁切保护约束">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(preset.protectHead)}
                onChange={(event) => onUpdate(preset.id, { protectHead: event.target.checked })}
              />
              <span>不裁头</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(preset.protectHands)}
                onChange={(event) => onUpdate(preset.id, { protectHands: event.target.checked })}
              />
              <span>不裁手</span>
            </label>
          </div>
          <div className="crop-guard-options" aria-label="适用视角">
            {viewAngles.map((viewAngle) => (
              <label className="checkbox-row" key={viewAngle}>
                <input
                  type="checkbox"
                  checked={activeViewAngles.includes(viewAngle)}
                  onChange={(event) => toggleViewAngle(viewAngle, event.target.checked)}
                />
                <span>{viewAngleLabels[viewAngle]}</span>
              </label>
            ))}
          </div>
          <div className={`preset-status ${preset.status ?? "draft"}`}>
            {preset.status === "ready" ? "正式策略" : preset.status === "incomplete" ? "残缺策略" : "草稿"}
          </div>
        </section>

        <section className="editor-card training-editor">
          <div className="section-header">
            <div>
              <h2>训练</h2>
              <p>上传原图并手动画裁切框，最少 5 组</p>
            </div>
            <button type="button" className="upload-samples-button" onClick={() => trainingInputRef.current?.click()}>
              <ImageUp size={17} />
              <span>上传样本</span>
            </button>
          </div>
          <input
            ref={trainingInputRef}
            hidden
            multiple
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              void loadTrainingSamples(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <div className="training-meta">
            <div className="sample-count">{trainSamples.length}/5 训练样本</div>
            <button
              className="reanalyze-samples-button"
              type="button"
              onClick={reanalyzeUnknownSamples}
              disabled={samples.length === 0 || isAnalyzing}
            >
              <RefreshCw size={17} />
              <span>重新识别未知样本</span>
            </button>
            <button className="save-incomplete-button" type="button" onClick={saveIncompletePreset} disabled={trainSamples.length === 0 || isAnalyzing}>
              <Save size={17} />
              <span>保存残缺策略</span>
            </button>
            <button
              className={`calibrate-button ${trainSamples.length >= 5 ? "ready" : ""}`}
              type="button"
              onClick={trainPreset}
              disabled={trainSamples.length < 5 || isAnalyzing}
            >
              <Wand2 size={17} />
              <span>{isAnalyzing ? "识别中" : "确认开始训练构图策略"}</span>
            </button>
          </div>
          {trainingMessage && <p className="calibration-message">{trainingMessage}</p>}
          <div className="training-workspace">
            <div className="sample-list-panel">
              <div className="sample-list-header">
                <strong>样本列表</strong>
                <span>{samples.length} 张</span>
              </div>
              <div className="sample-list">
                {samples.map((sample) => (
                  <button
                    key={sample.id}
                    type="button"
                    className={selectedSample?.id === sample.id ? "active" : ""}
                    onClick={() => setSelectedSampleId(sample.id)}
                  >
                    <img src={sample.previewUrl} alt={sample.filename} />
                    <span>
                      <strong>{sample.filename}</strong>
                      <small className={sample.confirmed ? "confirmed" : sample.cropPreviewUrl ? "previewed" : ""}>
                        {sample.confirmed ? `已确认 · ${sample.set === "train" ? "训练" : "测试"}` : sample.cropPreviewUrl ? "已预览，待确认" : "待处理"} · {viewAngleLabels[sample.viewAngle ?? "front"]} · {providerLabel(sample.poseProvider)}
                      </small>
                    </span>
                  </button>
                ))}
                {samples.length === 0 && <div className="empty-state compact">上传样本后从这里选择图片</div>}
              </div>
            </div>
            <div className="sample-editor-panel">
              {selectedSample ? (
                <TrainingCard
                  key={selectedSample.id}
                  aspectRatio={preset.width / preset.height}
                  sample={selectedSample}
                  onConfirm={confirmSample}
                  onPreview={previewSample}
                  onUpdate={updateSample}
                />
              ) : (
                <div className="empty-state">上传样本后开始裁切</div>
              )}
            </div>
          </div>
          {diagnostics && <TrainingDiagnosticsPanel diagnostics={diagnostics} />}
        </section>
      </div>
    </section>
  );
}

function TrainingDiagnosticsPanel({ diagnostics }: { diagnostics: TrainingDiagnostics }) {
  const rejected = diagnostics.rows.filter((row) => !row.kept).length;
  return (
    <section className="diagnostics-panel">
      <div className="sample-list-header">
        <strong>偏差诊断</strong>
        <span>阈值 {formatMetric(diagnostics.threshold)} · 过滤 {rejected} 组</span>
      </div>
      {diagnostics.center && (
        <div className="diagnostic-center">
          {diagnostics.center.mode === "pose_semantic" ? (
            <>
              <span>上边界 {semanticAnchorLabel(diagnostics.center.topAnchor)}</span>
              <span>下边界 {semanticAnchorLabel(diagnostics.center.bottomAnchor)}</span>
              <span>中心 {formatCenterPolicy(diagnostics.center.centerOffset ?? 0)}</span>
            </>
          ) : (
            <>
              <span>L {formatMetric(diagnostics.center.left)}</span>
              <span>T {formatMetric(diagnostics.center.top)}</span>
              <span>W {formatMetric(diagnostics.center.width)}</span>
              <span>H {formatMetric(diagnostics.center.height)}</span>
            </>
          )}
        </div>
      )}
      <div className="diagnostic-table">
        <div className="diagnostic-row head">
          <span>样本</span>
          <span>状态</span>
          <span>偏差</span>
          <span>构图数据</span>
        </div>
        {diagnostics.rows.map((row) => (
          <div className={`diagnostic-row ${row.kept ? "" : "rejected"}`} key={row.sampleId}>
            <span>{row.filename}</span>
            <span>{row.kept ? "保留" : "偏差过大"}</span>
            <span>{formatMetric(row.distance)}</span>
            <span>{formatModelSummary(row.model)}</span>
          </div>
        ))}
      </div>
      {diagnostics.testRows.length > 0 && (
        <div className="diagnostic-table">
          <div className="diagnostic-row head">
            <span>测试样本</span>
            <span>IoU</span>
            <span>中心误差</span>
            <span>说明</span>
          </div>
          {diagnostics.testRows.map((row) => (
            <div className="diagnostic-row" key={row.sampleId}>
              <span>{row.filename}</span>
              <span>{formatMetric(row.iou)}</span>
              <span>{formatMetric(row.centerError)}</span>
              <span>{row.iou >= 0.7 ? "接近人工裁切" : "和人工裁切差异较大"}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function makeTestDiagnostics(testSamples: TrainingSample[], keptModels: ModelWithSample[]) {
  if (keptModels.length === 0) return [];
  const composition = {
    left: median(keptModels.map((item) => item.left)),
    top: median(keptModels.map((item) => item.top)),
    width: median(keptModels.map((item) => item.width)),
    height: median(keptModels.map((item) => item.height))
  };
  return testSamples
    .map((sample) => {
      const bounds = personBounds(sample.keypoints);
      if (!bounds) return null;
      const predicted = {
        left: bounds.left + composition.left * bounds.width,
        top: bounds.top + composition.top * bounds.height,
        width: composition.width * bounds.width,
        height: composition.height * bounds.height
      };
      return {
        sampleId: sample.id,
        filename: sample.filename,
        iou: cropIou(predicted, sample.crop),
        centerError:
          Math.hypot(
            predicted.left + predicted.width / 2 - (sample.crop.left + sample.crop.width / 2),
            predicted.top + predicted.height / 2 - (sample.crop.top + sample.crop.height / 2)
          ) / Math.max(1, Math.hypot(sample.source.width, sample.source.height))
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function cropIou(a: TrainingSample["crop"], b: TrainingSample["crop"]) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function makeTrainingModels(samples: TrainingSample[]) {
  return samples
    .map((sample) => {
      const model = compositionForSample(sample);
      return model
        ? ({
            ...model,
            sampleId: sample.id,
            filename: sample.filename
          } as ModelWithSample)
        : null;
    })
    .filter((model): model is ModelWithSample => Boolean(model));
}

function formatMetric(value: number) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(3);
}

function formatModelSummary(model: LearnedComposition) {
  if (model.mode === "pose_semantic") {
    return `${model.explanation ?? "语义构图"} · ${formatCenterPolicy(model.centerOffset ?? 0)}`;
  }
  return `L ${formatMetric(model.left)} · T ${formatMetric(model.top)} · W ${formatMetric(model.width)} · H ${formatMetric(model.height)}`;
}

function formatCenterPolicy(offset: number) {
  if (Math.abs(offset) < 0.03) return "人物居中";
  return offset > 0 ? `向右微调 ${formatMetric(offset)}` : `向左微调 ${formatMetric(Math.abs(offset))}`;
}

function normalizeSamples(samples: TrainingSample[]) {
  return samples.map((sample) => ({
    ...sample,
    imageUrl: sample.imageUrl,
    previewUrl: sample.previewUrl || sample.imageUrl,
    viewAngle: sample.viewAngle ?? "front",
    poseProvider: sample.poseProvider ?? "unknown",
    set: sample.set ?? "train",
    confirmed: Boolean(sample.confirmed),
    cropPreviewUrl: sample.cropPreviewUrl ?? null
  }));
}

function samplesForStorage(samples: TrainingSample[]) {
  return samples.map(({ cropPreviewUrl: _cropPreviewUrl, previewUrl: _previewUrl, ...sample }) => sample);
}

function renderCropPreview(sample: TrainingSample) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sample.crop.width));
      canvas.height = Math.max(1, Math.round(sample.crop.height));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("无法创建预览画布"));
        return;
      }
      context.drawImage(
        image,
        sample.crop.left,
        sample.crop.top,
        sample.crop.width,
        sample.crop.height,
        0,
        0,
        canvas.width,
        canvas.height
      );
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("图片加载失败，无法生成预览"));
    image.src = sample.previewUrl;
  });
}

function providerLabel(provider: TrainingSample["poseProvider"]) {
  if (provider === "rtmw") return "RTMW-l";
  if (provider === "heuristic") return "旧方案";
  return "未知来源";
}

const viewAngles: ViewAngle[] = ["front", "side", "back"];
