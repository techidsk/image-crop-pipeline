import { BriefcaseBusiness, Eye, Layers3, ListChecks, Scissors, Workflow } from "lucide-react";
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
          <h1>Crop Pipeline</h1>
          <p>Python 工作流 · React 控制台</p>
        </div>
      </div>
      <nav className="side-nav" aria-label="Views">
        <div className="side-nav-section">
          <span className="side-nav-title">工作流</span>
          <button className={view === "batchJobs" ? "active" : ""} onClick={() => onNavigate("batchJobs")}>
            <Workflow size={17} />
            <span>Pipeline 任务</span>
          </button>
          <button className={view === "batch" ? "active" : ""} onClick={() => onNavigate("batch")}>
            <Scissors size={17} />
            <span>单批次试跑</span>
          </button>
        </div>

        <div className="side-nav-section">
          <span className="side-nav-title">配置模块</span>
          <button className={view === "sceneList" ? "active" : ""} onClick={() => onNavigate("sceneList")}>
            <BriefcaseBusiness size={17} />
            <span>场景 / 品牌</span>
          </button>
          <button className={view === "presetList" || view === "presetEditor" ? "active" : ""} onClick={() => onNavigate("presetList")}>
            <Layers3 size={17} />
            <span>裁切预设</span>
          </button>
        </div>

        <div className="side-nav-section">
          <span className="side-nav-title">诊断工具</span>
          <button className={view === "viewTest" ? "active" : ""} onClick={() => onNavigate("viewTest")}>
            <Eye size={17} />
            <span>视角测试</span>
          </button>
        </div>
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
