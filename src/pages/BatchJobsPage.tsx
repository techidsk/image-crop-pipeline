import { AlertTriangle, CheckCircle2, Download, FolderInput, ImageUp, Play, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CropCard } from "../components/CropCard";
import type { BatchJob, CropScene, PoseProviderId, ProcessResponse, ReviewStatus } from "../types";

type BatchJobsPageProps = {
  scenes: CropScene[];
  jobs: BatchJob[];
  poseProvider: PoseProviderId;
  onJobCreated: (job: BatchJob) => void;
  onJobUpdated: (job: BatchJob) => void;
};

type StreamEvent =
  | { type: "start"; jobId: string; total: number; presetCount: number; outputDir: string }
  | { type: "active"; jobId: string; completed: number; total: number; filename: string }
  | { type: "progress"; jobId: string; completed: number; total: number; filename: string; outputs: number; error?: string; result?: ProcessResponse }
  | { type: "final"; job: BatchJob; images: ProcessResponse[] }
  | { type: "error"; message: string; job?: BatchJob };

type RunProgress = {
  jobId: string;
  total: number;
  completed: number;
  presetCount: number;
  outputDir: string;
  activeFilename: string;
  events: Array<{ filename: string; outputs: number; error?: string }>;
};

export function BatchJobsPage({ scenes, jobs, poseProvider, onJobCreated, onJobUpdated }: BatchJobsPageProps) {
  const activeScenes = scenes.filter((scene) => scene.status !== "archived");
  const [sceneId, setSceneId] = useState(activeScenes[0]?.id ?? "");
  const [outputDir, setOutputDir] = useState("outputs");
  const [files, setFiles] = useState<File[]>([]);
  const [resultsByJob, setResultsByJob] = useState<Record<string, ProcessResponse[]>>({});
  const [selectedJobId, setSelectedJobId] = useState("");
  const [activeResult, setActiveResult] = useState(0);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedScene = activeScenes.find((scene) => scene.id === sceneId) ?? activeScenes[0];
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0];
  const selectedResults = selectedJob ? resultsByJob[selectedJob.id] ?? [] : [];
  const active = selectedResults[activeResult];
  const rerunnableFiles = useMemo(() => filesForRerun(files, selectedJob), [files, selectedJob]);

  useEffect(() => {
    if (!sceneId && activeScenes[0]) setSceneId(activeScenes[0].id);
  }, [activeScenes, sceneId]);

  useEffect(() => {
    if (!selectedJobId && jobs[0]) setSelectedJobId(jobs[0].id);
  }, [jobs, selectedJobId]);

  const selectedLabel = useMemo(() => {
    if (files.length === 0) return "上传多张原图";
    return `${files.length} 张原图待处理`;
  }, [files.length]);

  const chooseFiles = (selected: FileList | null) => {
    setFiles(Array.from(selected ?? []));
    setActiveResult(0);
    setProgress(null);
    setError("");
  };

  const runJob = async () => {
    if (!selectedScene) {
      setError("请先创建或选择一个场景。");
      return;
    }
    if (files.length === 0) {
      setError("请先上传图片。");
      return;
    }
    await runStream("/api/batch-jobs/run-stream", files, {
      scene_id: selectedScene.id,
      output_dir: outputDir,
      pose_provider: poseProvider
    });
  };

  const rerunSelectedJob = async () => {
    if (!selectedJob) return;
    if (rerunnableFiles.length === 0) {
      setError("当前页面没有可用于重跑的失败或异常原图。跨会话重跑需要后续补原图归档。");
      return;
    }
    setIsRunning(true);
    setError("");
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
        setError(failed?.error ?? "重跑任务失败，请查看任务记录。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "重跑任务失败");
    } finally {
      setIsRunning(false);
    }
  };

  const runStream = async (url: string, uploadFiles: File[], fields: Record<string, string>) => {
    setIsRunning(true);
    setError("");
    setProgress(null);
    try {
      const formData = new FormData();
      uploadFiles.forEach((file) => formData.append("images", file));
      Object.entries(fields).forEach(([key, value]) => formData.append(key, value));
      const response = await fetch(url, { method: "POST", body: formData });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "任务执行失败");
      }
      await readStream(response.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务执行失败");
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
        events: []
      });
      return;
    }
    if (event.type === "active") {
      setProgress((current) =>
        current ? { ...current, completed: event.completed, activeFilename: event.filename } : current
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
              events: [...current.events, { filename: event.filename, outputs: event.outputs, error: event.error }]
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
        setError(failed?.error ?? "任务执行失败，请查看任务记录。");
      }
      return;
    }
    if (event.type === "error") {
      if (event.job) onJobCreated(event.job);
      setError(event.message);
    }
  };

  const updateJobReview = async (job: BatchJob, reviewStatus: ReviewStatus) => {
    setError("");
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
      setError(err instanceof Error ? err.message : "复核状态更新失败");
    }
  };

  const updateImageReview = async (job: BatchJob, filename: string, reviewStatus: ReviewStatus) => {
    setError("");
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
      setError(err instanceof Error ? err.message : "单图复核状态更新失败");
    }
  };

  const openOutputDir = async (job: BatchJob) => {
    setError("");
    try {
      const response = await fetch(`/api/batch-jobs/${job.id}/open-output`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "输出目录打开失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "输出目录打开失败");
    }
  };

  const downloadOutput = (job: BatchJob) => {
    window.location.href = `/api/batch-jobs/${job.id}/download`;
  };

  return (
    <section className="work-page batch-job-page">
      <div className="control-panel job-control-panel">
        <div className="section-header">
          <div>
            <h2>批量任务</h2>
            <p>选择品牌场景，多图批量跑姿态识别和裁切输出</p>
          </div>
        </div>
        <label>
          场景
          <select value={selectedScene?.id ?? ""} onChange={(event) => setSceneId(event.target.value)}>
            {activeScenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name} · {scene.brand || "未设置品牌"}
              </option>
            ))}
          </select>
        </label>
        <label>
          输出目录
          <span className="input-with-icon">
            <FolderInput size={16} />
            <input value={outputDir} onChange={(event) => setOutputDir(event.target.value)} placeholder="例如 C:\\exports\\brand-a 或 outputs" />
          </span>
        </label>
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
          <button type="button" onClick={runJob} disabled={isRunning}>
            <Play size={17} />
            <span>{isRunning ? "任务执行中" : "开始批量任务"}</span>
          </button>
          <button type="button" className="ghost" onClick={() => chooseFiles(null)}>
            <RotateCcw size={17} />
          </button>
        </div>
        <div className="summary-strip job-summary-strip">
          <span>{files.length} 张原图</span>
          <span>{selectedScene?.presetIds.length ?? 0} 个预设</span>
          <span>{files.length * (selectedScene?.presetIds.length ?? 0)} 张输出</span>
        </div>
        {progress && <ProgressPanel progress={progress} />}
        {selectedScene && (
          <div className="scene-mini-card">
            <strong>{selectedScene.brand || selectedScene.name}</strong>
            <span>{selectedScene.description || "暂无说明"}</span>
            <div className="row-tags compact">
              {selectedScene.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="file-list">
          {files.map((file, index) => (
            <button key={`${file.name}-${file.lastModified}`} type="button">
              <span>{file.name}</span>
              <small>{Math.round(file.size / 1024)} KB</small>
            </button>
          ))}
        </div>
      </div>

      <div className="main-stage">
        <div className="image-stage">
          {selectedJob ? (
            <div className="job-detail-view">
              <div className="result-header">
                <div>
                  <h2>{selectedJob.sceneName}</h2>
                  <span className="table-note">{selectedJob.id}</span>
                </div>
                <div className="row-actions">
                  <button type="button" className="review-action approve" onClick={() => void updateJobReview(selectedJob, "approved")}>
                    <CheckCircle2 size={15} />
                    <span>整单通过</span>
                  </button>
                  <button type="button" className="review-action reject" onClick={() => void updateJobReview(selectedJob, "rejected")}>
                    <XCircle size={15} />
                    <span>整单驳回</span>
                  </button>
                  <button type="button" className="review-action" onClick={rerunSelectedJob} disabled={isRunning || rerunnableFiles.length === 0}>
                    <RotateCcw size={15} />
                    <span>重跑异常</span>
                  </button>
                </div>
              </div>
              <div className="job-detail-grid">
                <JobImageList
                  job={selectedJob}
                  activeFilename={active?.filename}
                  onSelect={(filename) => {
                    const index = selectedResults.findIndex((result) => result.filename === filename);
                    setActiveResult(Math.max(0, index));
                  }}
                  onReview={(filename, reviewStatus) => void updateImageReview(selectedJob, filename, reviewStatus)}
                />
                <div className="job-output-panel">
                  {active ? (
                    <>
                      <div className="result-header compact">
                        <h2>{active.filename}</h2>
                        <span>{active.crops.length} 张输出</span>
                      </div>
                      <div className="crop-grid">
                        {active.crops.map((crop) => (
                          <CropCard key={`${active.filename}-${crop.presetId}`} filename={active.filename ?? "image"} crop={crop} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state compact">历史任务只保留任务明细；当前页面执行的任务会显示裁切预览。</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state">任务完成后查看每张图的输出</div>
          )}
        </div>
        <div className="result-panel job-history-panel">
          <div className="result-header">
            <h2>任务记录</h2>
            <span>{jobs.length} 条</span>
          </div>
          <div className="job-table-shell">
            <table className="preset-data-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>场景</th>
                  <th>输入/输出</th>
                  <th>输出目录</th>
                  <th>状态</th>
                  <th>复核</th>
                  <th>明细</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className={selectedJob?.id === job.id ? "selected" : ""} onClick={() => setSelectedJobId(job.id)}>
                    <td>
                      <strong>{job.id}</strong>
                      <span>{job.createdAt}</span>
                    </td>
                    <td>{job.sceneName}</td>
                    <td>{job.imageCount} / {job.outputCount}</td>
                    <td>
                      <div className="output-actions">
                        <button type="button" className="output-dir-button" onClick={(event) => { event.stopPropagation(); void openOutputDir(job); }}>
                          <FolderInput size={14} />
                          <span>{job.outputDir}</span>
                        </button>
                        <button
                          type="button"
                          className="download-output-button"
                          disabled={job.outputCount === 0}
                          onClick={(event) => { event.stopPropagation(); downloadOutput(job); }}
                        >
                          <Download size={14} />
                          下载
                        </button>
                      </div>
                    </td>
                    <td><span className={`status-pill ${job.status === "completed" ? "ready" : "incomplete"}`}>{job.status === "completed" ? "完成" : "失败"}</span></td>
                    <td><span className={`status-pill ${reviewClass(job.reviewStatus)}`}>{reviewLabel(job.reviewStatus)}</span></td>
                    <td>
                      <span className="table-note">
                        {job.images.find((image) => image.error)?.error || `${job.images.length} 张图片`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {jobs.length === 0 && <div className="empty-state compact">暂无任务记录</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function ProgressPanel({ progress }: { progress: RunProgress }) {
  const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <div className="progress-panel">
      <div className="result-header compact">
        <strong>{progress.jobId || "任务准备中"}</strong>
        <span>{progress.completed}/{progress.total}</span>
      </div>
      <div className="progress-bar"><span style={{ width: `${percent}%` }} /></div>
      <div className="progress-meta">
        <span>{progress.activeFilename || "等待开始"}</span>
        <span>{progress.presetCount} 个预设</span>
      </div>
      <div className="progress-events">
        {progress.events.slice(-4).map((event) => (
          <span key={`${event.filename}-${event.outputs}-${event.error ?? ""}`} className={event.error ? "failed" : ""}>
            {event.error ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            {event.filename} · {event.error || `${event.outputs} 张输出`}
          </span>
        ))}
      </div>
    </div>
  );
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
    <div className="job-image-list">
      {job.images.map((image) => (
        <button
          key={image.filename}
          type="button"
          className={activeFilename === image.filename ? "active" : ""}
          onClick={() => onSelect(image.filename)}
        >
          <span>
            <strong>{image.filename}</strong>
            <small>{image.error || `${image.outputs} 张输出`} · {reviewLabel(image.reviewStatus)}</small>
          </span>
          <span className="image-review-actions">
            <span className={`status-pill ${reviewClass(image.reviewStatus)}`}>{reviewLabel(image.reviewStatus)}</span>
            <span
              role="button"
              tabIndex={0}
              className="mark-image-rejected"
              onClick={(event) => {
                event.stopPropagation();
                onReview(image.filename, "rejected");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onReview(image.filename, "rejected");
              }}
            >
              标异常
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function filesForRerun(files: File[], job?: BatchJob) {
  if (!job) return [];
  const targets = new Set(
    job.images
      .filter((image) => image.error || image.reviewStatus === "rejected")
      .map((image) => image.filename)
  );
  return files.filter((file) => targets.has(file.name));
}

function reviewLabel(reviewStatus: ReviewStatus = "pending_review") {
  if (reviewStatus === "approved") return "已通过";
  if (reviewStatus === "rejected") return "异常";
  return "待复核";
}

function reviewClass(reviewStatus: ReviewStatus = "pending_review") {
  if (reviewStatus === "approved") return "ready";
  if (reviewStatus === "rejected") return "danger";
  return "incomplete";
}
