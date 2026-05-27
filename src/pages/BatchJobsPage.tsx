import { useEffect, useMemo, useState } from "react";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  WarningOutlined
} from "@ant-design/icons";
import {
  App,
  Badge,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Modal,
  Progress,
  Radio,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import { CropCard } from "../components/CropCard";
import { viewAngleLabels } from "../constants";
import { fetchBatchJobDetail } from "../api/presets";
import type {
  BatchJob,
  BatchJobImage,
  CropScene,
  PoseProviderId,
  ProcessResponse,
  ReviewStatus,
  ViewAngle
} from "../types";

const { Title, Text } = Typography;
const JOB_ID_PLACEHOLDER = "<任务ID>";
const LOOSE_IMAGE_FOLDER = "散图";
const VISIBLE_INPUT_FOLDER_COUNT = 4;

type UploadFileWithPath = File & { webkitRelativePath?: string };
type OutputLayout = "by_preset" | "single_folder";
type BatchQueueItem = { filename: string; folder: string };

type BatchJobsPageProps = {
  scenes: CropScene[];
  jobs: BatchJob[];
  poseProvider: PoseProviderId;
  openOutputDirEnabled: boolean;
  onJobCreated: (job: BatchJob) => void;
  onJobUpdated: (job: BatchJob) => void;
  onJobsRefresh: () => Promise<void>;
  onOpenPreset: (presetId: string) => void;
};

type StreamEvent =
  | {
      type: "start";
      jobId: string;
      total: number;
      presetCount: number;
      outputDir: string;
      files?: BatchQueueItem[];
    }
  | { type: "active"; jobId: string; completed: number; total: number; filename: string; folder?: string }
  | {
      type: "progress";
      jobId: string;
      completed: number;
      total: number;
      filename: string;
      folder?: string;
      outputs: number;
      error?: string;
      result?: ProcessResponse;
    }
  | { type: "final"; job: BatchJob; images: ProcessResponse[] }
  | { type: "error"; message: string; job?: BatchJob };

type RunProgress = {
  jobId: string;
  total: number;
  completed: number;
  presetCount: number;
  outputDir: string;
  activeFilename: string;
  activeFolder: string;
  queue: BatchQueueItem[];
  events: Array<{ filename: string; folder: string; outputs: number; error?: string }>;
};

const REVIEW_META: Record<ReviewStatus, { label: string; color: string }> = {
  pending_review: { label: "待复核", color: "gold" },
  approved: { label: "已通过", color: "green" },
  rejected: { label: "异常", color: "red" }
};

const viewAngleOptions: Array<{ label: string; value: ViewAngle }> = [
  { label: viewAngleLabels.front, value: "front" },
  { label: viewAngleLabels.side, value: "side" },
  { label: viewAngleLabels.back, value: "back" }
];

export function BatchJobsPage({
  scenes,
  jobs,
  poseProvider,
  openOutputDirEnabled,
  onJobCreated,
  onJobUpdated,
  onJobsRefresh,
  onOpenPreset
}: BatchJobsPageProps) {
  const { message } = App.useApp();
  const activeScenes = scenes.filter((scene) => scene.status !== "archived");
  const [sceneId, setSceneId] = useState(activeScenes[0]?.id ?? "");
  const [outputDir, setOutputDir] = useState("outputs");
  const outputLayout: OutputLayout = "single_folder";
  const [files, setFiles] = useState<File[]>([]);
  const [resultsByJob, setResultsByJob] = useState<Record<string, ProcessResponse[]>>({});
  const [selectedJobId, setSelectedJobId] = useState("");
  const [activeResult, setActiveResult] = useState(0);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [loadingJobId, setLoadingJobId] = useState("");
  const [isRefreshingJobs, setIsRefreshingJobs] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [correctedAngles, setCorrectedAngles] = useState<Record<string, Record<string, ViewAngle>>>({});

  const selectedScene = activeScenes.find((scene) => scene.id === sceneId) ?? activeScenes[0];
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0];
  const selectedResults = selectedJob ? resultsByJob[selectedJob.id] ?? [] : [];
  const selectedImage = selectedJob?.images[activeResult] ?? selectedJob?.images[0];
  const active = selectedImage
    ? selectedResults.find((result) => result.filename === selectedImage.filename)
    : selectedResults[activeResult];
  const activeFilename = selectedImage?.filename ?? active?.filename;
  const activeCorrectedAngle: ViewAngle = selectedJob && activeFilename
    ? correctedAngles[selectedJob.id]?.[activeFilename] ?? active?.viewAngle ?? "front"
    : "front";
  const rerunnableFiles = useMemo(() => filesForRerun(files, selectedJob), [files, selectedJob]);
  const inputFolders = useMemo(() => getInputFolders(files), [files]);
  const outputPreviewRows = useMemo(
    () => buildOutputPreviewRows(files, outputDir, selectedScene?.presetIds.length ?? 0),
    [files, outputDir, selectedScene?.presetIds.length]
  );

  useEffect(() => {
    if (!sceneId && activeScenes[0]) setSceneId(activeScenes[0].id);
  }, [activeScenes, sceneId]);

  useEffect(() => {
    if (!selectedJobId && jobs[0]) setSelectedJobId(jobs[0].id);
  }, [jobs, selectedJobId]);

  useEffect(() => {
    if (!selectedJobId || resultsByJob[selectedJobId]) return;
    void loadJobDetail(selectedJobId);
  }, [selectedJobId, resultsByJob]);

  const fileList = useMemo<UploadFile[]>(
    () =>
      files.map((file, index) => ({
        uid: `${file.name}-${file.lastModified}-${index}`,
        name: getFileRelativePath(file),
        size: file.size,
        status: "done" as const
      })),
    [files]
  );

  const replaceFiles = (next: File[]) => {
    setFiles(next);
    setActiveResult(0);
    setProgress(null);
  };

  const runJob = async () => {
    if (!selectedScene) {
      void message.warning("请先创建或选择一个场景");
      return;
    }
    if (files.length === 0) {
      void message.warning("请先上传图片");
      return;
    }
    await runStream("/api/batch-jobs/run-stream", files, {
      scene_id: selectedScene.id,
      output_dir: outputDir,
      pose_provider: poseProvider,
      output_layout: outputLayout
    });
  };

  const rerunAllSelectedJob = async () => {
    if (!selectedJob) return;
    setIsRunning(true);
    setProgress(null);
    try {
      const response = await fetch(
        `/api/batch-jobs/${encodeURIComponent(selectedJob.id)}/rerun-all`,
        { method: "POST" }
      );
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "整单重跑失败");
      }
      await readStream(response.body);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "整单重跑失败");
    } finally {
      setIsRunning(false);
    }
  };

  const rerunSelectedJob = async () => {
    if (!selectedJob) return;
    if (rerunnableFiles.length === 0) {
      void message.warning("当前页面没有可用于重跑的失败或异常原图，跨会话重跑需要后续补原图归档");
      return;
    }
    setIsRunning(true);
    try {
      const formData = new FormData();
      rerunnableFiles.forEach((file) => formData.append("images", file));
      const response = await fetch(`/api/batch-jobs/${encodeURIComponent(selectedJob.id)}/rerun`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "重跑任务失败");
      }
      const body = (await response.json()) as { job: BatchJob; images: ProcessResponse[] };
      setResultsByJob((current) => ({ ...current, [body.job.id]: body.images }));
      setSelectedJobId(body.job.id);
      setActiveResult(0);
      onJobCreated(body.job);
      if (body.job.status !== "completed") {
        const failed = body.job.images.find((image) => image.error);
        void message.error(failed?.error ?? "重跑任务失败，请查看任务记录");
      } else {
        void message.success("重跑完成");
      }
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "重跑任务失败");
    } finally {
      setIsRunning(false);
    }
  };

  const loadJobDetail = async (jobId: string) => {
    setLoadingJobId(jobId);
    try {
      const detail = await fetchBatchJobDetail(jobId);
      setResultsByJob((current) => ({ ...current, [detail.job.id]: detail.images.map(withImageUrlCacheBust).filter(Boolean) as ProcessResponse[] }));
      onJobUpdated(detail.job);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "任务详情加载失败");
    } finally {
      setLoadingJobId((current) => (current === jobId ? "" : current));
    }
  };

  const refreshJobs = async () => {
    setIsRefreshingJobs(true);
    try {
      await onJobsRefresh();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "任务记录刷新失败");
    } finally {
      setIsRefreshingJobs(false);
    }
  };

  const regenerateSelectedImageWithView = async () => {
    if (!selectedJob || !activeFilename) return;
    setIsRunning(true);
    try {
      const response = await fetch(
        `/api/batch-jobs/${encodeURIComponent(selectedJob.id)}/images/${encodeURIComponent(activeFilename)}/regenerate-view`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewAngle: activeCorrectedAngle })
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "按修正朝向重生成失败");
      }
      const body = (await response.json()) as { job: BatchJob; images: ProcessResponse[] };
      const result = withImageUrlCacheBust(body.images[0]);
      if (!result) throw new Error("重生成没有返回裁切结果");
      setResultsByJob((current) => {
        const existing = current[body.job.id] ?? [];
        const replaced = existing.filter((item) => item.filename !== result.filename);
        return { ...current, [body.job.id]: [...replaced, result] };
      });
      onJobUpdated(body.job);
      void message.success(`已按${viewAngleLabels[activeCorrectedAngle]}重生成`);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "按修正朝向重生成失败");
    } finally {
      setIsRunning(false);
    }
  };

  const runStream = async (url: string, uploadFiles: File[], fields: Record<string, string>) => {
    setIsRunning(true);
    setProgress(null);
    try {
      const formData = new FormData();
      uploadFiles.forEach((file) => {
        formData.append("images", file);
        formData.append("image_paths", getFileRelativePath(file));
      });
      Object.entries(fields).forEach(([key, value]) => formData.append(key, value));
      const response = await fetch(url, { method: "POST", body: formData });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "任务执行失败");
      }
      await readStream(response.body);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "任务执行失败");
    } finally {
      setIsRunning(false);
    }
  };

  const readStream = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) handleStreamEvent(JSON.parse(line) as StreamEvent);
      }
      if (done) break;
    }
    if (buffer.trim()) handleStreamEvent(JSON.parse(buffer) as StreamEvent);
  };

  const handleStreamEvent = (event: StreamEvent) => {
    if (event.type === "start") {
      setProgress({
        jobId: event.jobId,
        total: event.total,
        completed: 0,
        presetCount: event.presetCount,
        outputDir: event.outputDir,
        activeFilename: "",
        activeFolder: "",
        queue: event.files ?? [],
        events: []
      });
      return;
    }
    if (event.type === "active") {
      setProgress((current) =>
        current
          ? {
              ...current,
              completed: event.completed,
              activeFilename: event.filename,
              activeFolder: event.folder ?? getFolderFromPath(event.filename)
            }
          : current
      );
      return;
    }
    if (event.type === "progress") {
      setProgress((current) =>
        current
          ? {
              ...current,
              completed: event.completed,
              activeFilename: event.filename,
              activeFolder: event.folder ?? getFolderFromPath(event.filename),
              events: [
                ...current.events,
                {
                  filename: event.filename,
                  folder: event.folder ?? getFolderFromPath(event.filename),
                  outputs: event.outputs,
                  error: event.error
                }
              ]
            }
          : current
      );
      if (event.result) {
        setResultsByJob((current) => ({
          ...current,
          [event.jobId]: [...(current[event.jobId] ?? []), event.result!]
        }));
      }
      return;
    }
    if (event.type === "final") {
      setResultsByJob((current) => ({ ...current, [event.job.id]: event.images }));
      setSelectedJobId(event.job.id);
      setActiveResult(0);
      onJobCreated(event.job);
      if (event.job.status !== "completed") {
        const failed = event.job.images.find((image) => image.error);
        void message.error(failed?.error ?? "任务执行失败");
      } else {
        void message.success(`任务完成，共 ${event.images.length} 张图片`);
      }
      return;
    }
    if (event.type === "error") {
      if (event.job) onJobCreated(event.job);
      void message.error(event.message);
    }
  };

  const updateJobReview = async (job: BatchJob, reviewStatus: ReviewStatus) => {
    try {
      const response = await fetch(`/api/batch-jobs/${encodeURIComponent(job.id)}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "复核状态更新失败");
      }
      onJobUpdated((await response.json()) as BatchJob);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "复核状态更新失败");
    }
  };

  const updateImageReview = async (job: BatchJob, filename: string, reviewStatus: ReviewStatus) => {
    try {
      const response = await fetch(
        `/api/batch-jobs/${encodeURIComponent(job.id)}/images/${encodeURIComponent(filename)}/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewStatus })
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "单图复核状态更新失败");
      }
      onJobUpdated((await response.json()) as BatchJob);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "单图复核状态更新失败");
    }
  };

  const openOutputDir = async (job: BatchJob) => {
    try {
      const response = await fetch(`/api/batch-jobs/${job.id}/open-output`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "输出目录打开失败");
      }
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "输出目录打开失败");
    }
  };

  const downloadOutput = (job: BatchJob) => {
    window.location.href = `/api/batch-jobs/${job.id}/download`;
  };

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
  const folderUploadProps = {
    ...uploadProps,
    directory: true
  };

  const jobColumns: ColumnsType<BatchJob> = [
    {
      title: "任务",
      dataIndex: "id",
      key: "id",
      width: 200,
      render: (_, job) => (
        <Flex vertical>
          <Text strong>{job.id}</Text>
          <Text type="secondary">{job.createdAt}</Text>
        </Flex>
      )
    },
    { title: "场景", dataIndex: "sceneName", key: "sceneName" },
    {
      title: "输入/输出",
      key: "count",
      width: 110,
      render: (_, job) => `${job.imageCount} / ${job.outputCount}`
    },
    {
      title: "输出目录",
      dataIndex: "outputDir",
      key: "outputDir",
      render: (_, job) =>
        openOutputDirEnabled ? (
          <Button
            size="small"
            type="link"
            icon={<FolderOpenOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              void openOutputDir(job);
            }}
          >
            {job.outputDir}
          </Button>
        ) : (
          <Text type="secondary" ellipsis>{job.outputDir}</Text>
        )
    },
    {
      title: "下载",
      key: "download",
      width: 90,
      render: (_, job) => (
        <Button
          size="small"
          type="link"
          icon={<DownloadOutlined />}
          disabled={job.outputCount === 0}
          onClick={(event) => {
            event.stopPropagation();
            downloadOutput(job);
          }}
        >
          下载
        </Button>
      )
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (status: BatchJob["status"]) =>
        status === "completed" ? (
          <Tag color="green">完成</Tag>
        ) : status === "running" ? (
          <Tag color="processing">进行中</Tag>
        ) : (
          <Tag color="red">失败</Tag>
        )
    },
    {
      title: "复核",
      dataIndex: "reviewStatus",
      key: "reviewStatus",
      width: 90,
      render: (status: ReviewStatus = "pending_review") => (
        <Tag color={REVIEW_META[status].color} style={{ marginInlineEnd: 0 }}>
          {REVIEW_META[status].label}
        </Tag>
      )
    },
    {
      title: "明细",
      key: "detail",
      ellipsis: true,
      render: (_, job) => (
        <Text type="secondary" ellipsis>
          {job.images.find((image) => image.error)?.error || `${job.images.length} 张图片`}
        </Text>
      )
    }
  ];

  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "420px minmax(0, 1fr)" }}>
      <Card
        size="small"
        title={
          <Flex vertical gap={2}>
            <Title level={5} style={{ margin: 0 }}>批量任务</Title>
            <Text type="secondary">选择品牌场景，多图批量跑姿态识别和裁切输出</Text>
          </Flex>
        }
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Flex vertical gap={4}>
            <Text type="secondary">场景</Text>
            <Select
              value={selectedScene?.id}
              onChange={(value) => setSceneId(value)}
              options={activeScenes.map((scene) => ({
                value: scene.id,
                label: `${scene.name} · ${scene.brand || "未设置品牌"}`
              }))}
              placeholder="选择场景"
            />
          </Flex>
          <Flex vertical gap={4}>
            <Text type="secondary">输出目录</Text>
            <Input
              prefix={<FolderOpenOutlined />}
              value={outputDir}
              onChange={(event) => setOutputDir(event.target.value)}
              placeholder="默认 outputs；服务端部署时建议保持相对路径"
            />
          </Flex>
          {inputFolders.length > 0 && (
            <Flex align="center" justify="space-between">
              <Text type="secondary">输出结构跟随上传文件夹</Text>
              <Button
                size="small"
                type="link"
                icon={<EyeOutlined />}
                onClick={() => setPreviewOpen(true)}
              >
                预览输出文件夹
              </Button>
            </Flex>
          )}

          <Upload.Dragger {...uploadProps}>
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">
              {files.length === 0 ? "上传多张原图" : `${files.length} 张原图待处理`}
            </p>
            <p className="ant-upload-hint">可拖拽图片或文件夹；输出会保留上传文件夹结构</p>
          </Upload.Dragger>
          <Upload {...folderUploadProps}>
            <Button icon={<FolderOpenOutlined />}>选择文件夹</Button>
          </Upload>

          <InputFolderSummary folders={inputFolders} fileCount={files.length} />

          <Space>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={isRunning}
              onClick={runJob}
            >
              {isRunning ? "任务执行中" : "开始批量任务"}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => replaceFiles([])}>清空</Button>
          </Space>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <Statistic title="原图" value={files.length} />
            <Statistic title="预设" value={selectedScene?.presetIds.length ?? 0} />
            <Statistic
              title="预期输出"
              value={files.length * (selectedScene?.presetIds.length ?? 0)}
            />
          </div>

          {progress && <ProgressPanel progress={progress} />}

          {selectedScene && (
            <Card size="small" type="inner" title={selectedScene.brand || selectedScene.name}>
              <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                <Text type="secondary">
                  {selectedScene.description || "暂无说明"}
                </Text>
                {selectedScene.tags.length > 0 && (
                  <Space size={4} wrap>
                    {selectedScene.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
                  </Space>
                )}
              </Space>
            </Card>
          )}

          {files.length > 0 && (
            <Card size="small" type="inner" title="文件列表" styles={{ body: { padding: 0, maxHeight: 200, overflow: "auto" } }}>
              {files.map((file, index) => (
                <div key={`${getFileRelativePath(file)}-${file.lastModified}-${index}`} className="list-row-button" style={{ cursor: "default" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {getFileRelativePath(file)}
                  </span>
                  <Text type="secondary">{Math.round(file.size / 1024)} KB</Text>
                </div>
              ))}
            </Card>
          )}
        </Space>
      </Card>
      <Modal
        title="输出文件夹预览"
        open={previewOpen}
        footer={null}
        width={720}
        onCancel={() => setPreviewOpen(false)}
      >
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Text type="secondary">
            实际任务会把 {JOB_ID_PLACEHOLDER} 替换为本次任务编号。
          </Text>
          <Table
            rowKey="folder"
            size="small"
            pagination={false}
            columns={[
              { title: "输入文件夹", dataIndex: "folder", key: "folder", width: 180 },
              { title: "输出位置", dataIndex: "path", key: "path", render: (value: string) => <Text copyable ellipsis>{value}</Text> },
              { title: "预计输出", dataIndex: "count", key: "count", width: 100 }
            ]}
            dataSource={outputPreviewRows}
          />
        </Space>
      </Modal>

      <Flex vertical gap={12}>
        <Card
          size="small"
          title={selectedJob ? selectedJob.sceneName : "任务详情"}
          loading={Boolean(selectedJob && loadingJobId === selectedJob.id)}
          extra={
            selectedJob && (
              <Space>
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={() => void updateJobReview(selectedJob, "approved")}
                >
                  整单通过
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => void updateJobReview(selectedJob, "rejected")}
                >
                  整单驳回
                </Button>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  disabled={isRunning}
                  onClick={rerunAllSelectedJob}
                >
                  整单重跑
                </Button>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  disabled={isRunning || rerunnableFiles.length === 0}
                  onClick={rerunSelectedJob}
                >
                  重跑异常
                </Button>
              </Space>
            )
          }
        >
          {selectedJob ? (
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "260px minmax(0, 1fr)" }}>
              <JobImageList
                job={selectedJob}
                activeFilename={active?.filename}
                onSelect={(filename) => {
                  const index = selectedJob.images.findIndex((image) => image.filename === filename);
                  setActiveResult(Math.max(0, index));
                }}
                onReview={(filename, reviewStatus) =>
                  void updateImageReview(selectedJob, filename, reviewStatus)
                }
              />
              <div>
                {active ? (
                  <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                    <Flex align="center" justify="space-between">
                      <Space size={8} wrap>
                        <Text strong>{active.filename}</Text>
                        <Tag color="cyan">{viewAngleLabels[active.viewAngle]}</Tag>
                        <Text type="secondary">{active.crops.length} 张输出</Text>
                      </Space>
                      <Space>
                        <AngleCorrectionControls
                          value={activeCorrectedAngle}
                          loading={isRunning}
                          onChange={(value) => {
                            if (!selectedJob || !activeFilename) return;
                            setCorrectedAngles((current) => ({
                              ...current,
                              [selectedJob.id]: {
                                ...(current[selectedJob.id] ?? {}),
                                [activeFilename]: value
                              }
                            }));
                          }}
                          onRegenerate={regenerateSelectedImageWithView}
                        />
                      </Space>
                    </Flex>
                    <div
                      style={{
                        display: "grid",
                        gap: 12,
                        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))"
                      }}
                    >
                      {active.crops.map((crop) => (
                        <CropCard
                          key={`${active.filename}-${crop.presetId}`}
                          filename={active.filename ?? "image"}
                          crop={crop}
                          onOpenPreset={onOpenPreset}
                        />
                      ))}
                    </div>
                  </Space>
                ) : (
                  <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                    {activeFilename && (
                      <Flex align="center" justify="space-between">
                        <Text strong>{activeFilename}</Text>
                        <Space>
                          <AngleCorrectionControls
                            value={activeCorrectedAngle}
                            loading={isRunning}
                            onChange={(value) => {
                              if (!selectedJob || !activeFilename) return;
                              setCorrectedAngles((current) => ({
                                ...current,
                                [selectedJob.id]: {
                                  ...(current[selectedJob.id] ?? {}),
                                  [activeFilename]: value
                                }
                              }));
                            }}
                            onRegenerate={regenerateSelectedImageWithView}
                          />
                        </Space>
                      </Flex>
                    )}
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="历史任务可按修正朝向重生成；生成后会显示裁切预览"
                    />
                  </Space>
                )}
              </div>
            </div>
          ) : (
            <Empty description="任务完成后查看每张图的输出" />
          )}
        </Card>

        <Card
          size="small"
          title="任务记录"
          extra={
            <Space>
              <Text type="secondary">{jobs.length} 条</Text>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={isRefreshingJobs}
                onClick={() => void refreshJobs()}
              >
                刷新
              </Button>
            </Space>
          }
        >
          <Table
            rowKey="id"
            size="small"
            columns={jobColumns}
            dataSource={jobs}
            pagination={{ pageSize: 10, hideOnSinglePage: true, size: "small" }}
            rowClassName={(job) => (selectedJob?.id === job.id ? "row-highlight" : "")}
            onRow={(job) => ({
              onClick: () => {
                setSelectedJobId(job.id);
                if (!resultsByJob[job.id]) void loadJobDetail(job.id);
              },
              style: { cursor: "pointer" }
            })}
            locale={{ emptyText: <Empty description="暂无任务记录" /> }}
          />
        </Card>
      </Flex>
    </div>
  );
}

function InputFolderSummary({ folders, fileCount }: { folders: string[]; fileCount: number }) {
  if (fileCount === 0) return null;

  const visibleFolders = folders.slice(0, VISIBLE_INPUT_FOLDER_COUNT);
  const hiddenFolders = folders.slice(VISIBLE_INPUT_FOLDER_COUNT);

  return (
    <Flex vertical gap={4}>
      <Flex align="center" justify="space-between">
        <Text type="secondary">上传来源</Text>
        <Text type="secondary">{folders.length} 个来源 · {fileCount} 张图</Text>
      </Flex>
      <Space size={4} wrap>
        {visibleFolders.map((folder) => (
          <Tag
            key={folder}
            color={folder === LOOSE_IMAGE_FOLDER ? "default" : "blue"}
            style={{
              maxWidth: 150,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {folder}
          </Tag>
        ))}
        {hiddenFolders.length > 0 && (
          <Tooltip title={hiddenFolders.join(" / ")}>
            <Tag color="default">+{hiddenFolders.length}</Tag>
          </Tooltip>
        )}
      </Space>
    </Flex>
  );
}

function AngleCorrectionControls({
  value,
  loading,
  onChange,
  onRegenerate
}: {
  value: ViewAngle;
  loading: boolean;
  onChange: (value: ViewAngle) => void;
  onRegenerate: () => void;
}) {
  return (
    <Space.Compact>
      <Radio.Group
        size="small"
        optionType="button"
        buttonStyle="solid"
        value={value}
        options={viewAngleOptions}
        onChange={(event) => onChange(event.target.value as ViewAngle)}
      />
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={loading}
        onClick={onRegenerate}
      >
        重生成
      </Button>
    </Space.Compact>
  );
}

function ProgressPanel({ progress }: { progress: RunProgress }) {
  const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const folderRows = buildFolderProgressRows(progress);
  return (
    <Card
      size="small"
      type="inner"
      title={progress.jobId || "任务准备中"}
      extra={<Text type="secondary">{progress.completed}/{progress.total}</Text>}
    >
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Progress percent={percent} size="small" status={percent === 100 ? "success" : "active"} />
        <Flex align="center" justify="space-between">
          <Space size={6}>
            <Tag color={progress.activeFolder ? "blue" : "default"} style={{ marginInlineEnd: 0 }}>
              {progress.activeFolder || "等待开始"}
            </Tag>
            <Text type="secondary" ellipsis>
              {progress.activeFilename || "等待开始"}
            </Text>
          </Space>
          <Tag color="cyan">{progress.presetCount} 个预设</Tag>
        </Flex>
        {folderRows.length > 0 && (
          <Flex vertical gap={6} style={{ maxHeight: 160, overflowY: "auto" }}>
            {folderRows.map((row) => (
              <Flex
                key={row.folder}
                align="center"
                justify="space-between"
                gap={8}
                style={{ padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}
              >
                <Space size={6} style={{ minWidth: 0 }}>
                  <FolderStatusIcon status={row.status} />
                  <Text ellipsis>{row.folder}</Text>
                </Space>
                <Space size={6}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {row.completed}/{row.total}
                  </Text>
                  <Tag color={FOLDER_STATUS_META[row.status].color} style={{ marginInlineEnd: 0 }}>
                    {FOLDER_STATUS_META[row.status].label}
                  </Tag>
                </Space>
              </Flex>
            ))}
          </Flex>
        )}
        <Flex vertical gap={4}>
          {progress.events.slice(-5).map((event, index) => (
            <Flex
              key={`${event.filename}-${index}`}
              align="center"
              gap={6}
              style={{ fontSize: 12, color: event.error ? "#cf1322" : "#3a4654" }}
            >
              {event.error ? <WarningOutlined /> : <CheckCircleOutlined />}
              <Text ellipsis>
                {event.folder} / {event.filename} · {event.error || `${event.outputs} 张输出`}
              </Text>
            </Flex>
          ))}
        </Flex>
      </Space>
    </Card>
  );
}

type FolderProgressStatus = "queued" | "running" | "completed" | "failed";

const FOLDER_STATUS_META: Record<FolderProgressStatus, { label: string; color: string }> = {
  queued: { label: "排队中", color: "default" },
  running: { label: "执行中", color: "processing" },
  completed: { label: "已完成", color: "green" },
  failed: { label: "有失败", color: "red" }
};

type FolderProgressRow = {
  folder: string;
  total: number;
  completed: number;
  failed: number;
  status: FolderProgressStatus;
};

function FolderStatusIcon({ status }: { status: FolderProgressStatus }) {
  if (status === "completed") return <CheckCircleOutlined style={{ color: "#389e0d" }} />;
  if (status === "failed") return <WarningOutlined style={{ color: "#cf1322" }} />;
  if (status === "running") return <PlayCircleOutlined style={{ color: "#1677ff" }} />;
  return <InboxOutlined style={{ color: "#8c8c8c" }} />;
}

function buildFolderProgressRows(progress: RunProgress): FolderProgressRow[] {
  const rows = new Map<string, FolderProgressRow>();

  const ensureRow = (folder: string): FolderProgressRow => {
    const key = folder || LOOSE_IMAGE_FOLDER;
    const existing = rows.get(key);
    if (existing) return existing;
    const row: FolderProgressRow = {
      folder: key,
      total: 0,
      completed: 0,
      failed: 0,
      status: "queued"
    };
    rows.set(key, row);
    return row;
  };

  progress.queue.forEach((item) => {
    ensureRow(item.folder).total += 1;
  });
  progress.events.forEach((event) => {
    const row = ensureRow(event.folder);
    if (row.total === 0) row.total = progress.queue.length > 0 ? row.total : 1;
    row.completed += 1;
    if (event.error) row.failed += 1;
  });
  if (progress.activeFolder) ensureRow(progress.activeFolder);

  return [...rows.values()].map((row) => {
    const isRunning = progress.activeFolder === row.folder && progress.completed < progress.total;
    const isComplete = row.total > 0 && row.completed >= row.total;
    return {
      ...row,
      status: isRunning ? "running" : isComplete ? (row.failed > 0 ? "failed" : "completed") : "queued"
    };
  });
}

function JobImageList({
  job,
  activeFilename,
  onSelect,
  onReview
}: {
  job: BatchJob;
  activeFilename?: string;
  onSelect: (filename: string) => void;
  onReview: (filename: string, reviewStatus: ReviewStatus) => void;
}) {
  return (
    <Flex
      vertical
      style={{
        maxHeight: 520,
        overflow: "auto",
        borderRadius: 6,
        border: "1px solid #e6ebe6"
      }}
    >
      {job.images.map((image) => {
        const reviewStatus = image.reviewStatus ?? "pending_review";
        const isActive = activeFilename === image.filename;
        return (
          <Flex
            key={image.filename}
            vertical
            gap={4}
            className={isActive ? "list-row-button is-active" : "list-row-button"}
            style={{ cursor: "default", display: "flex", flexDirection: "column", alignItems: "stretch" }}
          >
            <button
              type="button"
              onClick={() => onSelect(image.filename)}
              style={{
                display: "flex",
                width: "100%",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 2,
                background: "transparent",
                border: 0,
                padding: 0,
                textAlign: "left",
                fontSize: 12,
                cursor: "pointer"
              }}
            >
              <Text strong style={{ maxWidth: 220 }} ellipsis>
                {image.filename}
              </Text>
              <Text type="secondary">
                {image.error || `${image.outputs} 张输出`}
              </Text>
            </button>
            <Flex align="center" justify="space-between">
              <Tag color={REVIEW_META[reviewStatus].color} style={{ marginInlineEnd: 0 }}>
                {REVIEW_META[reviewStatus].label}
              </Tag>
              <Button
                size="small"
                type="text"
                danger
                onClick={() => onReview(image.filename, "rejected")}
              >
                标异常
              </Button>
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
}

function filesForRerun(files: File[], job?: BatchJob): File[] {
  if (!job) return [];
  const targets = new Set(
    job.images
      .filter((image: BatchJobImage) => image.error || image.reviewStatus === "rejected")
      .map((image) => image.filename)
  );
  return files.filter((file) => targets.has(getFileRelativePath(file)) || targets.has(file.name));
}

function withImageUrlCacheBust(result: ProcessResponse | undefined): ProcessResponse | undefined {
  if (!result) return result;
  const version = Date.now();
  return {
    ...result,
    crops: result.crops.map((crop) => ({
      ...crop,
      imageUrl: crop.imageUrl ? `${crop.imageUrl}${crop.imageUrl.includes("?") ? "&" : "?"}v=${version}` : crop.imageUrl
    }))
  };
}

function getFileRelativePath(file: File): string {
  const relativePath = (file as UploadFileWithPath).webkitRelativePath;
  return normalizeUploadPath(relativePath || file.name);
}

function normalizeUploadPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part: string) => part && part !== "." && part !== "..")
    .join("/") || "image";
}

function getFolderFromPath(value: string): string {
  const parts = normalizeUploadPath(value).split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : LOOSE_IMAGE_FOLDER;
}

function getInputFolders(files: File[]): string[] {
  const folders = new Set<string>();
  files.forEach((file) => {
    const folder = getFolderFromPath(getFileRelativePath(file));
    folders.add(folder);
  });
  return [...folders].sort((left, right) => left.localeCompare(right));
}

function buildOutputPreviewRows(
  files: File[],
  outputDir: string,
  presetCount: number
): Array<{ folder: string; path: string; count: number }> {
  const counts = new Map<string, number>();
  files.forEach((file) => {
    const parts = getFileRelativePath(file).split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "散图";
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folder, fileCount]) => {
      const base = joinDisplayPath(outputDir || "outputs", JOB_ID_PLACEHOLDER);
      const groupPath = folder === "散图" ? base : joinDisplayPath(base, folder);
      return {
        folder,
        path: groupPath,
        count: fileCount * presetCount
      };
    });
}

function joinDisplayPath(...parts: string[]): string {
  return parts
    .map((part) => part.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}
