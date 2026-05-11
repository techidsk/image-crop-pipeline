import { FolderInput, ImageUp, Play, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CropCard } from "../components/CropCard";
import type { BatchJob, CropScene, PoseProviderId, ProcessResponse } from "../types";

type BatchJobsPageProps = {
  scenes: CropScene[];
  jobs: BatchJob[];
  poseProvider: PoseProviderId;
  onJobCreated: (job: BatchJob) => void;
};

export function BatchJobsPage({ scenes, jobs, poseProvider, onJobCreated }: BatchJobsPageProps) {
  const activeScenes = scenes.filter((scene) => scene.status !== "archived");
  const [sceneId, setSceneId] = useState(activeScenes[0]?.id ?? "");
  const [outputDir, setOutputDir] = useState("outputs");
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ProcessResponse[]>([]);
  const [activeResult, setActiveResult] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedScene = activeScenes.find((scene) => scene.id === sceneId) ?? activeScenes[0];
  const selectedLabel = useMemo(() => {
    if (files.length === 0) return "上传多张原图";
    return `${files.length} 张原图待处理`;
  }, [files.length]);

  const chooseFiles = (selected: FileList | null) => {
    setFiles(Array.from(selected ?? []));
    setResults([]);
    setActiveResult(0);
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
    setIsRunning(true);
    setError("");
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("images", file));
      formData.append("scene_id", selectedScene.id);
      formData.append("output_dir", outputDir);
      formData.append("pose_provider", poseProvider);
      const response = await fetch("/api/batch-jobs/run", { method: "POST", body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail ?? "任务执行失败");
      }
      const body = (await response.json()) as { job: BatchJob; images: ProcessResponse[] };
      setResults(body.images);
      onJobCreated(body.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务执行失败");
    } finally {
      setIsRunning(false);
    }
  };

  const active = results[activeResult];

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
            <div className="overview">
              <div className="result-header">
                <h2>{active.filename}</h2>
                <span>{active.crops.length} 张输出</span>
              </div>
              <div className="crop-grid">
                {active.crops.map((crop) => (
                  <CropCard key={`${active.filename}-${crop.presetId}`} filename={active.filename ?? "image"} crop={crop} />
                ))}
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
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <strong>{job.id}</strong>
                      <span>{job.createdAt}</span>
                    </td>
                    <td>{job.sceneName}</td>
                    <td>{job.imageCount} / {job.outputCount}</td>
                    <td><span className="table-note">{job.outputDir}</span></td>
                    <td><span className={`status-pill ${job.status === "completed" ? "ready" : "incomplete"}`}>{job.status === "completed" ? "完成" : "失败"}</span></td>
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
