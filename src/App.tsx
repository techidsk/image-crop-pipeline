import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { App as AntdApp, Layout } from "antd";
import {
  fetchBatchJobs,
  fetchPresets,
  fetchScenes,
  fetchServerConfig,
  fetchStorageStatus,
  persistPresets,
  persistScenes,
  triggerStorageSync,
  type ServerConfig,
  type StorageStatus
} from "./api/presets";
import { Sidebar } from "./components/Sidebar";
import { defaultPresets } from "./constants";
import { BatchPage } from "./pages/BatchPage";
import { BatchJobsPage } from "./pages/BatchJobsPage";
import { PresetEditorPage } from "./pages/PresetEditorPage";
import { PresetListPage } from "./pages/PresetListPage";
import { SceneListPage } from "./pages/SceneListPage";
import { ViewTestPage } from "./pages/ViewTestPage";
import type { AppView, BatchJob, CropPreset, CropScene, PoseProviderId } from "./types";

const { Content } = Layout;

const pathForRoute = (view: AppView, presetId?: string) => {
  if (view === "batchJobs") return "/jobs";
  if (view === "batch") return "/batch";
  if (view === "sceneList") return "/scenes";
  if (view === "viewTest") return "/view-test";
  if (view === "presetEditor" && presetId) return `/presets/${encodeURIComponent(presetId)}`;
  return "/presets";
};

const viewForPath = (pathname: string): AppView => {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "jobs") return "batchJobs";
  if (parts[0] === "scenes") return "sceneList";
  if (parts[0] === "view-test") return "viewTest";
  if (parts[0] === "presets") return parts[1] ? "presetEditor" : "presetList";
  return "batch";
};

type PresetEditorRouteProps = {
  presets: CropPreset[];
  allTags: string[];
  poseProvider: PoseProviderId;
  onUpdate: (id: string, patch: Partial<CropPreset>) => void;
  onBack: () => void;
};

function PresetEditorRoute({ presets, allTags, poseProvider, onUpdate, onBack }: PresetEditorRouteProps) {
  const { presetId } = useParams();
  const preset = presets.find((item) => item.id === presetId);
  if (!preset) return <Navigate to="/presets" replace />;
  return (
    <PresetEditorPage
      preset={preset}
      allTags={allTags}
      poseProvider={poseProvider}
      onBack={onBack}
      onUpdate={onUpdate}
    />
  );
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntdApp.useApp();
  const [presets, setPresets] = useState<CropPreset[]>(defaultPresets);
  const [scenes, setScenes] = useState<CropScene[]>([]);
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [poseProvider, setPoseProvider] = useState<PoseProviderId>("rtmw");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const view = viewForPath(location.pathname);

  useEffect(() => {
    void loadPresets();
    void loadScenes();
    void loadJobs();
    void loadStorageStatus();
    void loadServerConfig();
  }, []);

  useEffect(() => {
    if (view === "batchJobs") void loadJobs();
  }, [view]);

  const allTags = useMemo(
    () => Array.from(new Set(presets.flatMap((preset) => preset.tags))).sort(),
    [presets]
  );

  const selectedPresets = useMemo(() => {
    if (activeTags.length === 0) return presets;
    return presets.filter((preset) => activeTags.every((tag) => preset.tags.includes(tag)));
  }, [activeTags, presets]);

  const loadPresets = async () => {
    try {
      setPresets(await fetchPresets());
    } catch (err) {
      setError(err instanceof Error ? err.message : "预设加载失败");
    }
  };

  const loadScenes = async () => {
    try {
      setScenes(await fetchScenes());
    } catch (err) {
      setError(err instanceof Error ? err.message : "场景加载失败");
    }
  };

  const loadJobs = async () => {
    try {
      setJobs(await fetchBatchJobs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务记录加载失败");
    }
  };

  const loadStorageStatus = async () => {
    try {
      setStorageStatus(await fetchStorageStatus());
    } catch {
      // 存储状态非关键功能，加载失败时静默忽略
    }
  };

  const loadServerConfig = async () => {
    try {
      setServerConfig(await fetchServerConfig());
    } catch {
      // 服务端配置加载失败时按保守策略禁用本地功能
    }
  };

  const syncStorage = async () => {
    try {
      setStorageStatus(await triggerStorageSync());
      void message.success("云端同步完成");
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "云端同步失败");
    }
  };

  const updateJob = (job: BatchJob) => {
    setJobs((current) => current.map((item) => (item.id === job.id ? job : item)));
  };

  const savePresets = async (nextPresets: CropPreset[]) => {
    setPresets(nextPresets);
    setPresets(await persistPresets(nextPresets));
    void loadStorageStatus();
  };

  const saveScenes = async (nextScenes: CropScene[]) => {
    setScenes(nextScenes);
    try {
      setScenes(await persistScenes(nextScenes));
      void loadStorageStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "场景保存失败");
    }
  };

  const navigateTo = (nextView: AppView, presetId?: string) => {
    navigate(pathForRoute(nextView, presetId));
  };

  const updatePreset = (id: string, patch: Partial<CropPreset>) => {
    const nextPresets = presets.map((preset) => (preset.id === id ? { ...preset, ...patch } : preset));
    void savePresets(nextPresets).catch((err) =>
      setError(err instanceof Error ? err.message : "预设保存失败")
    );
  };

  const addPreset = () => {
    const id = `preset-${Date.now()}`;
    const nextPreset: CropPreset = {
      id,
      name: "新裁切预设",
      tags: ["draft"],
      width: 1200,
      height: 1600,
      anchor: "neck",
      strategy: "anchor_center",
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      composition: null,
      orientation: "front",
      status: "draft",
      note: ""
    };
    navigateTo("presetEditor", id);
    void savePresets([...presets, nextPreset]).catch((err) =>
      setError(err instanceof Error ? err.message : "预设保存失败")
    );
  };

  const duplicatePreset = (preset: CropPreset) => {
    const copy = { ...preset, id: `${preset.id}-copy-${Date.now()}`, name: `${preset.name} 副本` };
    navigateTo("presetEditor", copy.id);
    void savePresets([...presets, copy]).catch((err) =>
      setError(err instanceof Error ? err.message : "预设保存失败")
    );
  };

  const openEditor = (id: string) => {
    navigateTo("presetEditor", id);
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sidebar
        view={view}
        error={error}
        poseProvider={poseProvider}
        storageStatus={storageStatus}
        onNavigate={navigateTo}
        onPoseProviderChange={setPoseProvider}
        onSyncStorage={syncStorage}
      />
      <Layout>
        <Content style={{ padding: 16, overflow: "auto" }}>
          <Routes>
            <Route path="/" element={<Navigate to="/batch" replace />} />
            <Route
              path="/batch"
              element={
                <BatchPage
                  allTags={allTags}
                  activeTags={activeTags}
                  presets={selectedPresets}
                  poseProvider={poseProvider}
                  onToggleTag={(tag) =>
                    setActiveTags((current) =>
                      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
                    )
                  }
                />
              }
            />
            <Route
              path="/jobs"
              element={
                <BatchJobsPage
                  scenes={scenes}
                  jobs={jobs}
                  poseProvider={poseProvider}
                  openOutputDirEnabled={serverConfig?.features.openOutputDir ?? false}
                  onJobCreated={(job) => setJobs((current) => [job, ...current])}
                  onJobUpdated={updateJob}
                  onJobsRefresh={loadJobs}
                />
              }
            />
            <Route path="/view-test" element={<ViewTestPage poseProvider={poseProvider} />} />
            <Route
              path="/scenes"
              element={
                <SceneListPage
                  scenes={scenes}
                  presets={presets}
                  onSave={(nextScenes) => void saveScenes(nextScenes)}
                />
              }
            />
            <Route
              path="/presets"
              element={
                <PresetListPage
                  allTags={allTags}
                  presets={presets}
                  onAdd={addPreset}
                  onDuplicate={duplicatePreset}
                  onEdit={openEditor}
                  onSetStatus={(id, status) => updatePreset(id, { status })}
                  poseProvider={poseProvider}
                />
              }
            />
            <Route
              path="/presets/:presetId"
              element={
                <PresetEditorRoute
                  presets={presets}
                  allTags={allTags}
                  poseProvider={poseProvider}
                  onUpdate={updatePreset}
                  onBack={() => navigateTo("presetList")}
                />
              }
            />
            <Route path="*" element={<Navigate to="/batch" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
