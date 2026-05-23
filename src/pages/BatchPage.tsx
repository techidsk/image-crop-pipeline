import { useMemo, useRef, useState } from "react";
import { InboxOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { App, Button, Card, Empty, Image, Space, Statistic, Tag, Typography, Upload } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { CropCard } from "../components/CropCard";
import { ResultOverview } from "../components/ResultOverview";
import type { CropPreset, PoseProviderId, ProcessResponse } from "../types";

const { Title, Text } = Typography;

type BatchPageProps = {
  allTags: string[];
  activeTags: string[];
  presets: CropPreset[];
  poseProvider: PoseProviderId;
  onToggleTag: (tag: string) => void;
};

export function BatchPage({ allTags, activeTags, presets, poseProvider, onToggleTag }: BatchPageProps) {
  const { message } = App.useApp();
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [results, setResults] = useState<ProcessResponse[]>([]);
  const [activeResult, setActiveResult] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const previewUrlsRef = useRef<string[]>([]);

  const fileList = useMemo<UploadFile[]>(
    () =>
      files.map((file, index) => ({
        uid: `${file.name}-${file.lastModified}-${index}`,
        name: file.name,
        size: file.size,
        status: "done" as const
      })),
    [files]
  );

  const replaceFiles = (nextFiles: File[]) => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    const urls = nextFiles.map((file) => URL.createObjectURL(file));
    previewUrlsRef.current = urls;
    setFiles(nextFiles);
    setPreviewUrls(urls);
    setResults([]);
    setActiveResult(0);
  };

  const processImages = async () => {
    if (files.length === 0) {
      void message.warning("请先选择图片");
      return;
    }
    if (presets.length === 0) {
      void message.warning("当前标签筛选下没有可用预设");
      return;
    }

    setIsProcessing(true);
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
      void message.success(`已处理 ${body.images.length} 张图片`);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "处理失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const active = results[activeResult];
  const totalOutputs = useMemo(
    () => results.reduce((sum, item) => sum + item.crops.length, 0),
    [results]
  );

  const uploadProps = {
    multiple: true,
    accept: "image/png,image/jpeg,image/webp",
    showUploadList: false,
    fileList,
    beforeUpload: (_file: File, allFiles: File[]) => {
      replaceFiles(allFiles);
      return false;
    },
    onRemove: () => replaceFiles([])
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Card
        size="small"
        title={
          <div className="flex flex-col gap-0.5">
            <Title level={5} style={{ margin: 0 }}>批量处理</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>按标签筛选预设，再批量生成输出</Text>
          </div>
        }
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Upload.Dragger {...uploadProps}>
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">
              {files.length === 0
                ? "点击或拖拽图片到此处"
                : files.length === 1
                  ? files[0].name
                  : `${files.length} 张图片待处理`}
            </p>
            <p className="ant-upload-hint">支持多选，PNG / JPEG / WEBP</p>
          </Upload.Dragger>

          <Space>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={isProcessing}
              onClick={processImages}
            >
              {isProcessing ? "处理中" : "批量识别并裁切"}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => replaceFiles([])}>
              清空
            </Button>
          </Space>

          <div className="grid grid-cols-3 gap-2">
            <Statistic title="原图" value={files.length} styles={{ content: { fontSize: 16 } }} />
            <Statistic title="预设" value={presets.length} styles={{ content: { fontSize: 16 } }} />
            <Statistic
              title="预期输出"
              value={files.length * presets.length}
              styles={{ content: { fontSize: 16 } }}
            />
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-col gap-1">
              <Text type="secondary" style={{ fontSize: 12 }}>标签筛选</Text>
              <Space size={4} wrap>
                {allTags.map((tag) => (
                  <Tag.CheckableTag
                    key={tag}
                    checked={activeTags.includes(tag)}
                    onChange={() => onToggleTag(tag)}
                  >
                    {tag}
                  </Tag.CheckableTag>
                ))}
              </Space>
            </div>
          )}

          {files.length > 0 && (
            <Card size="small" type="inner" title="文件列表" styles={{ body: { padding: 0, maxHeight: 200, overflow: "auto" } }}>
              {files.map((file, index) => (
                <button
                  key={`${file.name}-${file.lastModified}`}
                  type="button"
                  className={`flex w-full items-center justify-between border-b border-[#f0f1ed] px-3 py-2 text-left text-xs last:border-b-0 ${
                    activeResult === index ? "bg-[#e3efed]" : "hover:bg-[#f7f8f5]"
                  }`}
                  onClick={() => setActiveResult(index)}
                >
                  <span className="truncate">{file.name}</span>
                  <Text type="secondary" style={{ fontSize: 10 }}>{Math.round(file.size / 1024)} KB</Text>
                </button>
              ))}
            </Card>
          )}
        </Space>
      </Card>

      <div className="flex flex-col gap-3">
        <Card size="small" styles={{ body: { minHeight: 360 } }}>
          {active ? (
            <ResultOverview result={active} />
          ) : previewUrls[0] ? (
            <Image src={previewUrls[0]} alt="原图预览" style={{ objectFit: "contain", maxHeight: 480 }} />
          ) : (
            <Empty description="选择图片后开始批量裁切" />
          )}
        </Card>
        {results.length > 0 && (
          <Card
            size="small"
            title={`${results.length} 张图片完成 · ${totalOutputs} 张输出`}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>当前：{active?.filename ?? "未选择"}</Text>}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
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
          </Card>
        )}
      </div>
    </div>
  );
}
