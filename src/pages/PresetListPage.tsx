import { useRef, useState } from "react";
import {
  CopyOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { App, Button, Card, Drawer, Empty, Flex, Image, Input, Segmented, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import { viewAngleLabels } from "../constants";
import type { CropPreset, PoseProviderId, PresetStatus, ProcessResponse } from "../types";

const { Title, Text } = Typography;

const STATUS_META: Record<PresetStatus, { label: string; color: string }> = {
  draft: { label: "草稿", color: "default" },
  incomplete: { label: "残缺策略", color: "gold" },
  ready: { label: "正式策略", color: "green" },
  archived: { label: "已停用", color: "red" }
};

const STATUS_OPTIONS = [
  { label: "全部", value: "all" },
  { label: "草稿", value: "draft" },
  { label: "残缺", value: "incomplete" },
  { label: "正式", value: "ready" },
  { label: "已停用", value: "archived" }
];
const VIEW_ANGLE_OPTIONS = [
  { label: "全部视角", value: "all" },
  { label: viewAngleLabels.front, value: "front" },
  { label: viewAngleLabels.side, value: "side" },
  { label: viewAngleLabels.back, value: "back" }
];

type StatusFilter = PresetStatus | "all";
type ViewAngleFilter = "front" | "side" | "back" | "all";

type PresetListPageProps = {
  allTags: string[];
  presets: CropPreset[];
  onAdd: () => void;
  onDuplicate: (preset: CropPreset) => void;
  onEdit: (id: string) => void;
  onSetStatus: (id: string, status: PresetStatus) => void;
  poseProvider: PoseProviderId;
};

export function PresetListPage({
  allTags,
  presets,
  onAdd,
  onDuplicate,
  onEdit,
  onSetStatus,
  poseProvider
}: PresetListPageProps) {
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewAngleFilter, setViewAngleFilter] = useState<ViewAngleFilter>("all");
  const [query, setQuery] = useState("");
  const [testingPreset, setTestingPreset] = useState<CropPreset | null>(null);

  const visiblePresets = presets.filter((preset) => {
    const status = preset.status ?? "draft";
    const tags = preset.tags ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (viewAngleFilter !== "all" && !presetViewAngles(preset).includes(viewAngleFilter)) return false;
    if (!activeTags.every((tag) => tags.includes(tag))) return false;
    if (!normalizedQuery) return true;
    return [
      preset.name,
      preset.id,
      preset.note,
      preset.width,
      preset.height,
      STATUS_META[status].label,
      ...tags
    ]
      .filter((item) => item !== undefined && item !== null)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });

  const toggleTag = (tag: string) => {
    setActiveTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  };

  const columns: ColumnsType<CropPreset> = [
    {
      title: "预设",
      dataIndex: "name",
      key: "name",
      render: (_, preset) => (
        <Flex vertical>
          <Text strong>{preset.name}</Text>
          <Text type="secondary">{preset.id}</Text>
        </Flex>
      )
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (_, preset) => {
        const status = preset.status ?? "draft";
        return <Tag color={STATUS_META[status].color}>{STATUS_META[status].label}</Tag>;
      }
    },
    {
      title: "适用视角",
      key: "viewAngles",
      width: 140,
      render: (_, preset) => <Tag color="cyan">{viewAngleText(preset)}</Tag>
    },
    {
      title: "输出尺寸",
      key: "size",
      width: 110,
      render: (_, preset) => `${preset.width}x${preset.height}`
    },
    {
      title: "标签",
      dataIndex: "tags",
      key: "tags",
      render: (_, preset) => (
        <Space size={4} wrap>
          {preset.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Space>
      )
    },
    {
      title: "说明",
      dataIndex: "note",
      key: "note",
      ellipsis: true,
      render: (note) => (
        <Text type="secondary" ellipsis>
          {note || "无说明"}
        </Text>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      align: "right",
      render: (_, preset) => {
        const archived = (preset.status ?? "draft") === "archived";
        return (
          <Space size={2}>
            <Button
              size="small"
              type="text"
              icon={<ExperimentOutlined />}
              title="测试"
              onClick={() => setTestingPreset(preset)}
            />
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              title="编辑"
              onClick={() => onEdit(preset.id)}
            />
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              title="复制"
              onClick={() => onDuplicate(preset)}
            />
            {archived ? (
              <Button
                size="small"
                type="text"
                icon={<ReloadOutlined />}
                title="恢复为草稿"
                onClick={() => onSetStatus(preset.id, "draft")}
              />
            ) : (
              <Button
                size="small"
                type="text"
                danger
                icon={<StopOutlined />}
                title="停用"
                onClick={() => onSetStatus(preset.id, "archived")}
              />
            )}
          </Space>
        );
      }
    }
  ];

  return (
    <>
      <Card
        title={
          <Flex vertical gap={2}>
            <Title level={5} style={{ margin: 0 }}>预设管理</Title>
            <Text type="secondary">筛选、测试和进入单个预设编辑</Text>
          </Flex>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
            新建预设
          </Button>
        }
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Space size={8} wrap>
            <Text type="secondary">状态</Text>
            <Segmented
              size="small"
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
            />
            <Text type="secondary">视角</Text>
            <Select
              size="small"
              value={viewAngleFilter}
              options={VIEW_ANGLE_OPTIONS}
              style={{ width: 110 }}
              onChange={(value) => setViewAngleFilter(value as ViewAngleFilter)}
            />
            <Input.Search
              allowClear
              size="small"
              placeholder="搜索名称、ID、尺寸、标签或说明"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ width: 260 }}
            />
          </Space>
          {allTags.length > 0 && (
            <Space size={4} wrap align="center">
              <Text type="secondary">标签</Text>
              {allTags.map((tag) => (
                <Tag.CheckableTag
                  key={tag}
                  checked={activeTags.includes(tag)}
                  onChange={() => toggleTag(tag)}
                >
                  {tag}
                </Tag.CheckableTag>
              ))}
            </Space>
          )}
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={visiblePresets}
            pagination={{ pageSize: 20, hideOnSinglePage: true, size: "small" }}
            rowClassName={(preset) => ((preset.status ?? "draft") === "archived" ? "row-faded" : "")}
            locale={{ emptyText: <Empty description="没有匹配的预设" /> }}
          />
        </Space>
      </Card>

      <Drawer
        open={Boolean(testingPreset)}
        onClose={() => setTestingPreset(null)}
        title={testingPreset ? `测试预设：${testingPreset.name}` : ""}
        width={720}
        destroyOnClose
      >
        {testingPreset && <PresetTestPanel preset={testingPreset} poseProvider={poseProvider} />}
      </Drawer>
    </>
  );
}

function PresetTestPanel({ preset, poseProvider }: { preset: CropPreset; poseProvider: PoseProviderId }) {
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [compareResults, setCompareResults] = useState<Record<string, ProcessResponse> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const previewRef = useRef("");

  const chooseFile = (nextFile: File | null) => {
    setFile(nextFile);
    setResult(null);
    setCompareResults(null);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = nextFile ? URL.createObjectURL(nextFile) : "";
    previewRef.current = url;
    setPreviewUrl(url);
  };

  const runTest = async () => {
    if (!file) {
      void message.warning("请先上传测试图片");
      return;
    }
    setIsProcessing(true);
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
      void message.error(err instanceof Error ? err.message : "测试失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const runCompare = async () => {
    if (!file) {
      void message.warning("请先上传测试图片");
      return;
    }
    setIsProcessing(true);
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
      void message.error(err instanceof Error ? err.message : "对比失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const uploadProps = {
    accept: "image/png,image/jpeg,image/webp",
    maxCount: 1,
    showUploadList: false,
    beforeUpload: (f: File) => {
      chooseFile(f);
      return false;
    },
    onRemove: () => chooseFile(null)
  };

  const crop = result?.crops[0];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Space size={4} wrap>
        <Tag>{preset.width}x{preset.height}</Tag>
        <Tag color="cyan">{viewAngleText(preset)}</Tag>
        <Tag color={STATUS_META[preset.status ?? "draft"].color}>
          {STATUS_META[preset.status ?? "draft"].label}
        </Tag>
      </Space>

      <Upload.Dragger {...uploadProps} fileList={[] as UploadFile[]}>
        <p className="ant-upload-drag-icon"><UploadOutlined /></p>
        <p className="ant-upload-text">{file ? file.name : "点击或拖拽一张测试图片"}</p>
      </Upload.Dragger>

      <Space>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          onClick={runTest}
          loading={isProcessing}
        >
          运行测试：{providerLabel(poseProvider)}
        </Button>
        <Button icon={<ExperimentOutlined />} onClick={runCompare} loading={isProcessing}>
          对比两种方案
        </Button>
      </Space>

      {previewUrl && (
        <Card size="small" title="原图">
          <Image src={previewUrl} alt="测试原图" style={{ maxHeight: 320, objectFit: "contain" }} />
        </Card>
      )}

      {compareResults ? (
        <Card size="small" title="对比结果">
          <Image.PreviewGroup>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              {Object.entries(compareResults).map(([provider, response]) => {
                const compareCrop = response.crops[0];
                return (
                  <Flex key={provider} vertical gap={4}>
                    <Text strong>{providerLabel(provider as PoseProviderId)}</Text>
                    {compareCrop ? (
                      <>
                        <Image
                          src={`data:image/png;base64,${compareCrop.image}`}
                          alt={provider}
                          style={{ objectFit: "contain", maxHeight: 220 }}
                        />
                        <Text type="secondary">
                          {compareCrop.width}x{compareCrop.height} · L{compareCrop.box.left} T{compareCrop.box.top}
                        </Text>
                      </>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无结果" />
                    )}
                  </Flex>
                );
              })}
            </div>
          </Image.PreviewGroup>
        </Card>
      ) : crop ? (
        <Card size="small" title={crop.name}>
          <Flex vertical gap={8}>
            <Image
              src={`data:image/png;base64,${crop.image}`}
              alt={crop.name}
              style={{ objectFit: "contain", maxHeight: 360 }}
            />
            <Text type="secondary">
              原图 {result?.source.width}x{result?.source.height} · 输出 {crop.width}x{crop.height}
            </Text>
            <Text type="secondary">
              BBox L{crop.box.left} T{crop.box.top} R{crop.box.right} B{crop.box.bottom}
            </Text>
          </Flex>
        </Card>
      ) : (
        <Empty description="运行测试后查看裁切结果" />
      )}
    </Space>
  );
}

function viewAngleText(preset: CropPreset) {
  const angles = presetViewAngles(preset);
  return angles.map((viewAngle) => viewAngleLabels[viewAngle]).join(" / ");
}

function presetViewAngles(preset: CropPreset) {
  return preset.viewAngles?.length ? preset.viewAngles : [preset.orientation ?? "front"];
}

function providerLabel(provider: PoseProviderId | string) {
  return provider === "heuristic" ? "旧方案" : "RTMW-l";
}
