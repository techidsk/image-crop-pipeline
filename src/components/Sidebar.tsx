import { BriefcaseBusiness, Eye, Layers3, Scissors, Workflow } from "lucide-react";
import type { AppView, PoseProviderId } from "../types";

type SidebarProps = {
  view: AppView;
  error: string;
  poseProvider: PoseProviderId;
  onNavigate: (view: AppView) => void;
  onPoseProviderChange: (provider: PoseProviderId) => void;
};

export function Sidebar({ view, error, poseProvider, onNavigate, onPoseProviderChange }: SidebarProps) {
  return (
    <aside className="app-sidebar">
      <div className="brand">
        <span className="mark">OP</span>
        <div>
          <h1>OpenPose Crop Pipeline</h1>
          <p>批量图片裁切工作台</p>
        </div>
      </div>
      <nav className="side-nav" aria-label="Views">
        <button className={view === "batch" ? "active" : ""} onClick={() => onNavigate("batch")}>
          <Scissors size={17} />
          <span>批量处理</span>
        </button>
        <button className={view === "batchJobs" ? "active" : ""} onClick={() => onNavigate("batchJobs")}>
          <Workflow size={17} />
          <span>批量任务</span>
        </button>
        <button className={view === "viewTest" ? "active" : ""} onClick={() => onNavigate("viewTest")}>
          <Eye size={17} />
          <span>视角测试</span>
        </button>
        <button className={view === "sceneList" ? "active" : ""} onClick={() => onNavigate("sceneList")}>
          <BriefcaseBusiness size={17} />
          <span>场景管理</span>
        </button>
        <button className={view === "presetList" || view === "presetEditor" ? "active" : ""} onClick={() => onNavigate("presetList")}>
          <Layers3 size={17} />
          <span>预设管理</span>
        </button>
      </nav>
      <label className="provider-select">
        姿态引擎
        <select value={poseProvider} onChange={(event) => onPoseProviderChange(event.target.value as PoseProviderId)}>
          <option value="rtmw">RTMW-l ONNX</option>
          <option value="heuristic">旧方案 / Heuristic</option>
        </select>
      </label>
      {error && <p className="error">{error}</p>}
    </aside>
  );
}
