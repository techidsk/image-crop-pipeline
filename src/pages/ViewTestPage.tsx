import { useMemo, useRef, useState } from "react";
import { InboxOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { App, Button, Card, Empty, Space, Statistic, Tag, Typography, Upload } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { viewAngleLabels } from "../constants";
import type { PoseAnalysis, PoseKeypoint, PoseProviderId, ViewAngle } from "../types";

const { Title, Text } = Typography;

type ViewTestPageProps = {
  poseProvider: PoseProviderId;
};

type PreviewImage = {
  file: File;
  url: string;
};

const VIEW_COLORS: Record<ViewAngle, string> = {
  front: "geekblue",
  side: "purple",
  back: "magenta"
};

export function ViewTestPage({ poseProvider }: ViewTestPageProps) {
  const { message } = App.useApp();
  const [previews, setPreviews] = useState<PreviewImage[]>([]);
  const [results, setResults] = useState<PoseAnalysis[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const previewsRef = useRef<PreviewImage[]>([]);

  const activePreview = previews[activeIndex];
  const activeResult = results[activeIndex];
  const activeViewAngle = activeResult ? resolvedViewAngle(activeResult) : null;

  const fileList = useMemo<UploadFile[]>(
    () =>
      previews.map((preview, index) => ({
        uid: `${preview.file.name}-${preview.file.lastModified}-${index}`,
        name: preview.file.name,
        size: preview.file.size,
        status: "done" as const
      })),
    [previews]
  );

  const replacePreviews = (nextFiles: File[]) => {
    previewsRef.current.forEach((preview) => URL.revokeObjectURL(preview.url));
    const next = nextFiles.map((file) => ({ file, url: URL.createObjectURL(file) }));
    previewsRef.current = next;
    setPreviews(next);
    setResults([]);
    setActiveIndex(0);
  };

  const analyzeViews = async () => {
    if (previews.length === 0) {
      void message.warning("请先选择图片");
      return;
    }
    setIsAnalyzing(true);
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
      void message.error(err instanceof Error ? err.message : "视角识别失败");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const uploadProps = {
    multiple: true,
    accept: "image/png,image/jpeg,image/webp",
    showUploadList: false,
    fileList,
    beforeUpload: (_file: File, allFiles: File[]) => {
      replacePreviews(allFiles);
      return false;
    },
    onRemove: () => replacePreviews([])
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Card
        size="small"
        title={
          <div className="flex flex-col gap-0.5">
            <Title level={5} style={{ margin: 0 }}>视角测试</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>上传图片并识别正面、侧面、背面</Text>
          </div>
        }
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Upload.Dragger {...uploadProps}>
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">
              {previews.length === 0
                ? "选择正面、侧面或背面图片"
                : previews.length === 1
                  ? previews[0].file.name
                  : `${previews.length} 张图片待识别`}
            </p>
          </Upload.Dragger>

          <Space>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={isAnalyzing}
              onClick={analyzeViews}
            >
              {isAnalyzing ? "识别中" : "开始识别视角"}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => replacePreviews([])}>清空</Button>
          </Space>

          <div className="grid grid-cols-3 gap-2">
            <Statistic title="图片" value={previews.length} styles={{ content: { fontSize: 16 } }} />
            <Statistic title="已识别" value={results.length} styles={{ content: { fontSize: 16 } }} />
            <div className="flex flex-col">
              <Text type="secondary" style={{ fontSize: 12 }}>引擎</Text>
              <Text strong>{providerLabel(poseProvider)}</Text>
            </div>
          </div>

          {previews.length > 0 && (
            <Card size="small" type="inner" title="文件列表" styles={{ body: { padding: 0, maxHeight: 240, overflow: "auto" } }}>
              {previews.map((preview, index) => {
                const result = results[index];
                const viewAngle = result ? resolvedViewAngle(result) : null;
                return (
                  <button
                    key={`${preview.file.name}-${preview.file.lastModified}`}
                    type="button"
                    className={`flex w-full items-center justify-between border-b border-[#f0f1ed] px-3 py-2 text-left text-xs last:border-b-0 ${
                      activeIndex === index ? "bg-[#e3efed]" : "hover:bg-[#f7f8f5]"
                    }`}
                    onClick={() => setActiveIndex(index)}
                  >
                    <span className="truncate">{preview.file.name}</span>
                    {viewAngle ? (
                      <Tag color={VIEW_COLORS[viewAngle]} style={{ marginInlineEnd: 0 }}>
                        {viewAngleLabels[viewAngle]}
                      </Tag>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 10 }}>
                        {Math.round(preview.file.size / 1024)} KB
                      </Text>
                    )}
                  </button>
                );
              })}
            </Card>
          )}
        </Space>
      </Card>

      <div className="flex flex-col gap-3">
        <Card size="small" styles={{ body: { minHeight: 420, padding: 12 } }}>
          {activePreview ? (
            <PosePreview previewUrl={activePreview.url} result={activeResult} />
          ) : (
            <Empty description="选择图片后开始测试视角识别" />
          )}
        </Card>
        {activeResult && activeViewAngle && (
          <Card size="small">
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Space size={8} wrap>
                <Tag color={VIEW_COLORS[activeViewAngle]} style={{ fontSize: 14, padding: "2px 10px" }}>
                  {viewAngleLabels[activeViewAngle]}
                </Tag>
                <Title level={5} style={{ margin: 0 }}>{activeResult.filename ?? activePreview?.file.name}</Title>
              </Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                原图 {activeResult.source.width}x{activeResult.source.height} · {activeResult.keypoints.length} 个节点
              </Text>
              <div className="grid grid-cols-3 gap-3">
                <Statistic
                  title="脸部点"
                  value={countVisible(activeResult, ["nose", "left_eye", "right_eye", "left_ear", "right_ear"])}
                  styles={{ content: { fontSize: 18 } }}
                />
                <Statistic
                  title="左侧身体点"
                  value={countVisible(activeResult, ["left_shoulder", "left_elbow", "left_wrist", "left_hip", "left_knee", "left_ankle"])}
                  styles={{ content: { fontSize: 18 } }}
                />
                <Statistic
                  title="右侧身体点"
                  value={countVisible(activeResult, ["right_shoulder", "right_elbow", "right_wrist", "right_hip", "right_knee", "right_ankle"])}
                  styles={{ content: { fontSize: 18 } }}
                />
              </div>
            </Space>
          </Card>
        )}
      </div>
    </div>
  );
}

function PosePreview({ previewUrl, result }: { previewUrl: string; result?: PoseAnalysis }) {
  const viewAngle = result ? resolvedViewAngle(result) : null;
  return (
    <div className="relative inline-block max-w-full">
      <img src={previewUrl} alt={result?.filename ?? "View test preview"} className="max-h-[520px] max-w-full" />
      {result && viewAngle && (
        <div className="absolute left-3 top-3">
          <Tag color={VIEW_COLORS[viewAngle]} style={{ fontSize: 13, padding: "2px 10px" }}>
            识别结论：{viewAngleLabels[viewAngle]}
          </Tag>
        </div>
      )}
      {result?.keypoints.map((point) => {
        if (point.confidence < 0.15) return null;
        return (
          <span
            key={point.name}
            title={`${point.name} ${point.confidence.toFixed(2)}`}
            className="pointer-events-none absolute h-2 w-2 -translate-x-1 -translate-y-1 rounded-full border border-white bg-[#1c6b62]"
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
