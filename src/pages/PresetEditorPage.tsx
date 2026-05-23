import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  App,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { viewAngleLabels } from "../constants";
import { NumberField } from "../components/NumberField";
import { TrainingCard } from "../components/TrainingCard";
import type {
  CropPreset,
  LearnedComposition,
  PoseProviderId,
  PresetStatus,
  TrainingSample,
  ViewAngle
} from "../types";
import {
  compositionForSample,
  filterModels,
  fitAspectCropAround,
  median,
  personBounds,
  round4,
  semanticAnchorLabel,
  summarizeSemanticComposition
} from "../utils/cropTraining";

const { Title, Text } = Typography;
const { TextArea } = Input;

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
  allTags: string[];
  poseProvider: PoseProviderId;
  onBack: () => void;
  onUpdate: (id: string, patch: Partial<CropPreset>) => void;
};

const viewAngles: ViewAngle[] = ["front", "side", "back"];

const STATUS_META: Record<PresetStatus, { label: string; color: string }> = {
  draft: { label: "草稿", color: "default" },
  incomplete: { label: "残缺策略", color: "gold" },
  ready: { label: "正式策略", color: "green" },
  archived: { label: "已停用", color: "red" }
};

export function PresetEditorPage({ preset, allTags, poseProvider, onBack, onUpdate }: PresetEditorPageProps) {
  const { message } = App.useApp();
  const [samples, setSamples] = useState<TrainingSample[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<TrainingDiagnostics | null>(null);
  const confirmedSamples = samples.filter((sample) => sample.confirmed);
  const trainSamples = confirmedSamples.filter((sample) => sample.set === "train");
  const testSamples = confirmedSamples.filter((sample) => sample.set === "test");
  const selectedSample = samples.find((sample) => sample.id === selectedSampleId) ?? samples[0];
  const activeViewAngles = preset.viewAngles?.length ? preset.viewAngles : viewAngles;
  const loadedRef = useRef("");

  useEffect(() => {
    if (loadedRef.current === preset.id) return;
    loadedRef.current = preset.id;
    void loadSavedSamples();
  }, [preset.id]);

  const loadSavedSamples = async () => {
    try {
      const response = await fetch(`/api/presets/${encodeURIComponent(preset.id)}/training-samples`);
      if (!response.ok) throw new Error("训练样本加载失败");
      const body = (await response.json()) as { samples: TrainingSample[] };
      const loaded = normalizeSamples(body.samples);
      setSamples(loaded);
      setSelectedSampleId(loaded[0]?.id ?? "");
      setDiagnostics(null);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "训练样本加载失败");
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

  const loadTrainingSamples = async (files: File[]) => {
    if (files.length === 0) return;
    setIsAnalyzing(true);
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
        message.error(err instanceof Error ? err.message : "训练样本保存失败")
      );
      setSelectedSampleId((current) => current || nextSamples[0]?.id || "");
      void message.success(`已上传 ${files.length} 个样本`);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "样本上传失败");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const reanalyzeUnknownSamples = async () => {
    setIsAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append("pose_provider", poseProvider);
      formData.append("only_unknown", "true");
      const response = await fetch(
        `/api/presets/${encodeURIComponent(preset.id)}/training-samples/reanalyze`,
        { method: "POST", body: formData }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "样本重新识别失败");
      }
      const body = (await response.json()) as { samples: TrainingSample[] };
      const nextSamples = normalizeSamples(body.samples);
      setSamples(nextSamples);
      setSelectedSampleId((current) => current || nextSamples[0]?.id || "");
      void message.success(`已使用 ${providerLabel(poseProvider)} 重新识别未知来源样本`);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "样本重新识别失败");
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
        message.error(err instanceof Error ? err.message : "训练样本保存失败")
      );
      return nextSamples;
    });
  };

  const previewSample = async (sample: TrainingSample) => {
    try {
      const cropPreviewUrl = await renderCropPreview(sample);
      setSamples((current) =>
        current.map((item) => (item.id === sample.id ? { ...item, cropPreviewUrl } : item))
      );
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "裁切预览生成失败");
    }
  };

  const confirmSample = async (sample: TrainingSample) => {
    if (!sample.cropPreviewUrl) await previewSample(sample);
    setSamples((current) => {
      const nextSamples = current.map((item) =>
        item.id === sample.id ? { ...item, confirmed: true } : item
      );
      void persistSamples(nextSamples).catch((err) =>
        message.error(err instanceof Error ? err.message : "训练样本保存失败")
      );
      return nextSamples;
    });
  };

  const saveIncompletePreset = () => {
    if (trainSamples.length === 0) {
      void message.warning("至少需要确认 1 组训练样本，才能保存残缺策略");
      return;
    }
    const models = makeTrainingModels(trainSamples);
    if (models.length === 0) {
      void message.warning("当前训练样本缺少有效 OpenPose 人体范围，无法保存策略");
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
    void message.success(`已保存为残缺策略：使用 ${usable.length}/${trainSamples.length} 组训练样本`);
  };

  const trainPreset = () => {
    if (trainSamples.length < 5) {
      void message.warning("至少需要确认 5 组训练样本");
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
      void message.warning(
        `过滤偏差后不足 5 组：训练 ${trainSamples.length} 组，保留 ${filtered.kept.length} 组，过滤 ${
          trainSamples.length - filtered.kept.length
        } 组`
      );
      return;
    }
    savePresetComposition(filtered.kept, {
      status: "ready",
      note: `训练完成：使用 ${filtered.kept.length}/${trainSamples.length} 组训练样本，过滤 ${
        trainSamples.length - filtered.kept.length
      } 组偏差样本。`
    });
    void message.success(
      `已生成构图策略：训练 ${filtered.kept.length}/${trainSamples.length}，过滤 ${
        trainSamples.length - filtered.kept.length
      } 组偏差样本，测试集 ${testSamples.length} 组`
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
    if (nextAngles.length === 0) return;
    onUpdate(preset.id, {
      viewAngles: nextAngles,
      orientation: nextAngles.includes(preset.orientation ?? "front") ? preset.orientation : nextAngles[0]
    });
  };

  const tagOptions = Array.from(new Set([...allTags, ...preset.tags])).map((tag) => ({
    value: tag,
    label: tag
  }));

  const currentStatus = STATUS_META[preset.status ?? "draft"];

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card size="small">
        <div className="flex items-center justify-between gap-3">
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>
            <div className="flex flex-col">
              <Title level={4} style={{ margin: 0 }}>{preset.name}</Title>
              <Text type="secondary">编辑元数据、裁切参数和训练策略</Text>
            </div>
          </Space>
          <Tag color={currentStatus.color}>{currentStatus.label}</Tag>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card size="small" title="基础信息">
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <div className="flex flex-col gap-1">
              <Text type="secondary">名称</Text>
              <Input
                value={preset.name}
                onChange={(event) => onUpdate(preset.id, { name: event.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Text type="secondary">标签</Text>
              <Select
                mode="tags"
                value={preset.tags}
                placeholder="输入或选择标签"
                options={tagOptions}
                onChange={(tags) => onUpdate(preset.id, { tags: normalizeTags(tags) })}
                maxTagCount={8}
              />
              <Text type="secondary">
                小写字母/数字/连字符/下划线，最多 8 个
              </Text>
            </div>

            <div className="flex flex-col gap-1">
              <Text type="secondary">状态说明</Text>
              <TextArea
                rows={3}
                value={preset.note ?? ""}
                placeholder="样本不足、训练完成等状态说明"
                onChange={(event) => onUpdate(preset.id, { note: event.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="宽"
                value={preset.width}
                onChange={(width) => onUpdate(preset.id, { width })}
              />
              <NumberField
                label="高"
                value={preset.height}
                onChange={(height) => onUpdate(preset.id, { height })}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Text type="secondary">裁切保护</Text>
              <Space>
                <Checkbox
                  checked={Boolean(preset.protectHead)}
                  onChange={(event) => onUpdate(preset.id, { protectHead: event.target.checked })}
                >
                  不裁头
                </Checkbox>
                <Checkbox
                  checked={Boolean(preset.protectHands)}
                  onChange={(event) => onUpdate(preset.id, { protectHands: event.target.checked })}
                >
                  不裁手
                </Checkbox>
              </Space>
            </div>

            <div className="flex flex-col gap-1">
              <Text type="secondary">适用视角</Text>
              <Space>
                {viewAngles.map((viewAngle) => (
                  <Checkbox
                    key={viewAngle}
                    checked={activeViewAngles.includes(viewAngle)}
                    onChange={(event) => toggleViewAngle(viewAngle, event.target.checked)}
                  >
                    {viewAngleLabels[viewAngle]}
                  </Checkbox>
                ))}
              </Space>
            </div>
          </Space>
        </Card>

        <Card
          size="small"
          title={
            <div className="flex flex-col gap-0.5">
              <Title level={5} style={{ margin: 0 }}>训练</Title>
              <Text type="secondary">上传原图并手动画裁切框，最少 5 组</Text>
            </div>
          }
          extra={
            <Upload
              multiple
              accept="image/png,image/jpeg,image/webp"
              showUploadList={false}
              beforeUpload={(_file, allFiles) => {
                void loadTrainingSamples(allFiles);
                return false;
              }}
            >
              <Button type="primary" icon={<UploadOutlined />}>上传样本</Button>
            </Upload>
          }
        >
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#e6ebe6] bg-[#fafbfa] p-3">
              <Space size={12}>
                <Badge count={`${trainSamples.length}/5`} showZero color={trainSamples.length >= 5 ? "#1c6b62" : "#fa8c16"}>
                  <Text strong>训练样本</Text>
                </Badge>
                <Text type="secondary">测试集 {testSamples.length} 组</Text>
              </Space>
              <Space wrap>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={isAnalyzing}
                  disabled={samples.length === 0 || isAnalyzing}
                  onClick={reanalyzeUnknownSamples}
                >
                  重新识别未知
                </Button>
                <Button
                  size="small"
                  icon={<SaveOutlined />}
                  disabled={trainSamples.length === 0 || isAnalyzing}
                  onClick={saveIncompletePreset}
                >
                  保存残缺策略
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={isAnalyzing}
                  disabled={trainSamples.length < 5 || isAnalyzing}
                  onClick={trainPreset}
                >
                  {isAnalyzing ? "识别中" : "开始训练"}
                </Button>
              </Space>
            </div>

            <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
              <Card
                size="small"
                type="inner"
                title="样本列表"
                extra={<Text type="secondary">{samples.length} 张</Text>}
                styles={{ body: { padding: 0, maxHeight: 520, overflow: "auto" } }}
              >
                {samples.length === 0 ? (
                  <div className="p-3">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传样本后从这里选择" />
                  </div>
                ) : (
                  samples.map((sample) => (
                    <button
                      key={sample.id}
                      type="button"
                      onClick={() => setSelectedSampleId(sample.id)}
                      className={`flex w-full items-center gap-2 border-b border-[#f0f1ed] px-2 py-2 text-left text-xs last:border-b-0 ${
                        selectedSample?.id === sample.id ? "bg-[#e3efed]" : "hover:bg-[#f7f8f5]"
                      }`}
                    >
                      <img src={sample.previewUrl} alt={sample.filename} className="h-10 w-10 rounded object-cover" />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <Text strong ellipsis>{sample.filename}</Text>
                        <Space size={4}>
                          <Tag
                            color={sample.confirmed ? "green" : sample.cropPreviewUrl ? "blue" : "default"}
                            style={{ marginInlineEnd: 0 }}
                          >
                            {sample.confirmed
                              ? `已确认 · ${sample.set === "train" ? "训练" : "测试"}`
                              : sample.cropPreviewUrl
                                ? "已预览"
                                : "待处理"}
                          </Tag>
                          <Text type="secondary">
                            {viewAngleLabels[sample.viewAngle ?? "front"]} · {providerLabel(sample.poseProvider)}
                          </Text>
                        </Space>
                      </div>
                    </button>
                  ))
                )}
              </Card>

              <div>
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
                  <Card size="small">
                    <Empty description="上传样本后开始裁切" />
                  </Card>
                )}
              </div>
            </div>

            {diagnostics && <TrainingDiagnosticsPanel diagnostics={diagnostics} />}
          </Space>
        </Card>
      </div>
    </Space>
  );
}

function TrainingDiagnosticsPanel({ diagnostics }: { diagnostics: TrainingDiagnostics }) {
  const rejected = diagnostics.rows.filter((row) => !row.kept).length;
  const trainColumns: ColumnsType<TrainingDiagnostics["rows"][number]> = [
    { title: "样本", dataIndex: "filename", key: "filename", ellipsis: true },
    {
      title: "状态",
      dataIndex: "kept",
      key: "kept",
      width: 100,
      render: (kept: boolean) => (kept ? <Tag color="green">保留</Tag> : <Tag color="red">偏差过大</Tag>)
    },
    {
      title: "偏差",
      dataIndex: "distance",
      key: "distance",
      width: 90,
      render: (distance: number) => formatMetric(distance)
    },
    {
      title: "构图数据",
      dataIndex: "model",
      key: "model",
      render: (model: ModelWithSample) => formatModelSummary(model)
    }
  ];

  const testColumns: ColumnsType<TrainingDiagnostics["testRows"][number]> = [
    { title: "测试样本", dataIndex: "filename", key: "filename", ellipsis: true },
    {
      title: "IoU",
      dataIndex: "iou",
      key: "iou",
      width: 90,
      render: (iou: number) => formatMetric(iou)
    },
    {
      title: "中心误差",
      dataIndex: "centerError",
      key: "centerError",
      width: 110,
      render: (value: number) => formatMetric(value)
    },
    {
      title: "说明",
      dataIndex: "iou",
      key: "summary",
      render: (iou: number) =>
        iou >= 0.7 ? <Tag color="green">接近人工裁切</Tag> : <Tag color="gold">差异较大</Tag>
    }
  ];

  return (
    <Card size="small" type="inner" title="偏差诊断" extra={<Text type="secondary">阈值 {formatMetric(diagnostics.threshold)} · 过滤 {rejected} 组</Text>}>
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {diagnostics.center && (
          <Alert
            type="info"
            showIcon
            message="中心构图"
            description={
              diagnostics.center.mode === "pose_semantic" ? (
                <Space size={8} wrap>
                  <Tag>上 {semanticAnchorLabel(diagnostics.center.topAnchor)}</Tag>
                  <Tag>下 {semanticAnchorLabel(diagnostics.center.bottomAnchor)}</Tag>
                  <Tag>中心 {formatCenterPolicy(diagnostics.center.centerOffset ?? 0)}</Tag>
                </Space>
              ) : (
                <Space size={8} wrap>
                  <Tag>L {formatMetric(diagnostics.center.left)}</Tag>
                  <Tag>T {formatMetric(diagnostics.center.top)}</Tag>
                  <Tag>W {formatMetric(diagnostics.center.width)}</Tag>
                  <Tag>H {formatMetric(diagnostics.center.height)}</Tag>
                </Space>
              )
            }
          />
        )}
        <Table
          rowKey="sampleId"
          size="small"
          columns={trainColumns}
          dataSource={diagnostics.rows}
          pagination={false}
          scroll={{ y: 320 }}
        />
        {diagnostics.testRows.length > 0 && (
          <Table
            rowKey="sampleId"
            size="small"
            columns={testColumns}
            dataSource={diagnostics.testRows}
            pagination={false}
            scroll={{ y: 320 }}
          />
        )}
      </Space>
    </Card>
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

function providerLabel(provider: TrainingSample["poseProvider"] | string) {
  if (provider === "rtmw") return "RTMW-l";
  if (provider === "heuristic") return "旧方案";
  return "未知来源";
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    if (!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= 8) break;
  }
  return result;
}
