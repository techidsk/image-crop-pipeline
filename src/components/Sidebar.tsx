import { useState } from "react";
import { BriefcaseBusiness, Cloud, Eye, Layers3, RefreshCw } from "lucide-react";
import { Scissors, Workflow } from "lucide-react";
import type { StorageStatus } from "../api/presets";
import type { AppView, PoseProviderId } from "../types";

type SidebarProps = {
  view: AppView;
  error: string;
  poseProvider: PoseProviderId;
  storageStatus: StorageStatus | null;
  onNavigate: (view: AppView) => void;
  onPoseProviderChange: (provider: PoseProviderId) => void;
  onSyncStorage: () => Promise<void>;
};

const COLLECTION_LABELS: Record<string, string> = {
  presets: "预设",
  scenes: "场景"
};

const STATUS_LABELS: Record<string, string> = {
  synced: "已同步",
  pending: "待同步",
  unknown: "未知"
};

function StorageStatusPanel({
  storageStatus,
  onSyncStorage
}: {
  storageStatus: StorageStatus;
  onSyncStorage: () => Promise<void>;
}) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSyncStorage();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="storage-status">
      <div className="storage-status-head">
        <span>
          <Cloud size={13} /> 云端同步
        </span>
        <button type="button" onClick={() => void handleSync()} disabled={syncing}>
          <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
          {syncing ? "同步中" : "立即同步"}
        </button>
      </div>
      {Object.entries(storageStatus.collections).map(([name, info]) => (
        <div key={name} className={`storage-row ${info.status}`} title={info.lastError ?? ""}>
          <span>{COLLECTION_LABELS[name] ?? name}</span>
          <span className="storage-badge">{STATUS_LABELS[info.status] ?? info.status}</span>
        </div>
      ))}
    </div>
  );
}

export function Sidebar({
  view,
  error,
  poseProvider,
  storageStatus,
  onNavigate,
  onPoseProviderChange,
  onSyncStorage
}: SidebarProps) {
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

      {storageStatus?.cloudSync && (
        <StorageStatusPanel storageStatus={storageStatus} onSyncStorage={onSyncStorage} />
      )}

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
