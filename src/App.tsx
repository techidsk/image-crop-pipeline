import { useEffect, useMemo, useState } from "react";
import { fetchBatchJobs, fetchPresets, fetchScenes, persistPresets, persistScenes } from "./api/presets";
import { Sidebar } from "./components/Sidebar";
import { defaultPresets } from "./constants";
import { BatchPage } from "./pages/BatchPage";
import { BatchJobsPage } from "./pages/BatchJobsPage";
import { PresetEditorPage } from "./pages/PresetEditorPage";
import { PresetListPage } from "./pages/PresetListPage";
import { SceneListPage } from "./pages/SceneListPage";
import { ViewTestPage } from "./pages/ViewTestPage";
import type { AppView, BatchJob, CropPreset, CropScene, PoseProviderId } from "./types";

type AppRoute = {
  view: AppView;
  presetId?: string;
};

const routeForPath = (pathname: string): AppRoute => {
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] === "jobs") return { view: "batchJobs" };
  if (parts[0] === "batch") return { view: "batch" };
  if (parts[0] === "scenes") return { view: "sceneList" };
  if (parts[0] === "view-test") return { view: "viewTest" };
  if (parts[0] === "presets") {
    return parts[1] ? { view: "presetEditor", presetId: decodeURIComponent(parts[1]) } : { view: "presetList" };
  }

  return { view: "batch" };
};

const pathForRoute = (view: AppView, presetId?: string) => {
  if (view === "batchJobs") return "/jobs";
  if (view === "batch") return "/batch";
  if (view === "sceneList") return "/scenes";
  if (view === "viewTest") return "/view-test";
  if (view === "presetEditor" && presetId) return `/presets/${encodeURIComponent(presetId)}`;
  return "/presets";
};

export function App() {
  const initialRoute = routeForPath(window.location.pathname);
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [presets, setPresets] = useState<CropPreset[]>(defaultPresets);
  const [scenes, setScenes] = useState<CropScene[]>([]);
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [poseProvider, setPoseProvider] = useState<PoseProviderId>("rtmw");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [editingPresetId, setEditingPresetId] = useState(initialRoute.presetId ?? defaultPresets[0].id);
  const [error, setError] = useState("");
  const view = route.view;

  useEffect(() => {
    void loadPresets();
    void loadScenes();
    void loadJobs();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = routeForPath(window.location.pathname);
      setRoute(nextRoute);
      if (nextRoute.presetId) {
        setEditingPresetId(nextRoute.presetId);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const allTags = useMemo(
    () => Array.from(new Set(presets.flatMap((preset) => preset.tags))).sort(),
    [presets]
  );

  const selectedPresets = useMemo(() => {
    if (activeTags.length === 0) return presets;
    return presets.filter((preset) => activeTags.every((tag) => preset.tags.includes(tag)));
  }, [activeTags, presets]);

  const editingPreset = presets.find((preset) => preset.id === editingPresetId) ?? presets[0];

  const loadPresets = async () => {
    try {
      const loaded = await fetchPresets();
      setPresets(loaded);
      setEditingPresetId((current) => loaded.find((preset) => preset.id === current)?.id ?? loaded[0]?.id ?? "");
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

  const updateJob = (job: BatchJob) => {
    setJobs((current) => current.map((item) => (item.id === job.id ? job : item)));
  };

  const savePresets = async (nextPresets: CropPreset[]) => {
    setPresets(nextPresets);
    const saved = await persistPresets(nextPresets);
    setPresets(saved);
    setEditingPresetId((current) => saved.find((preset) => preset.id === current)?.id ?? saved[0]?.id ?? "");
  };

  const saveScenes = async (nextScenes: CropScene[]) => {
    setScenes(nextScenes);
    try {
      setScenes(await persistScenes(nextScenes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "场景保存失败");
    }
  };

  const navigateTo = (nextView: AppView, presetId?: string) => {
    const path = pathForRoute(nextView, presetId);
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
    setRoute({ view: nextView, presetId });
    if (presetId) {
      setEditingPresetId(presetId);
    }
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
    setEditingPresetId(id);
    navigateTo("presetEditor", id);
    void savePresets([...presets, nextPreset]).catch((err) =>
      setError(err instanceof Error ? err.message : "预设保存失败")
    );
  };

  const duplicatePreset = (preset: CropPreset) => {
    const copy = { ...preset, id: `${preset.id}-copy-${Date.now()}`, name: `${preset.name} 副本` };
    setEditingPresetId(copy.id);
    navigateTo("presetEditor", copy.id);
    void savePresets([...presets, copy]).catch((err) =>
      setError(err instanceof Error ? err.message : "预设保存失败")
    );
  };

  const removePreset = (id: string) => {
    const nextPresets = presets.filter((preset) => preset.id !== id);
    if (editingPresetId === id) {
      setEditingPresetId(nextPresets[0]?.id ?? "");
      navigateTo("presetList");
    }
    void savePresets(nextPresets).catch((err) =>
      setError(err instanceof Error ? err.message : "预设保存失败")
    );
  };

  const openEditor = (id: string) => {
    setEditingPresetId(id);
    navigateTo("presetEditor", id);
  };

  return (
    <main className="app-shell">
      <Sidebar
        view={view}
        error={error}
        poseProvider={poseProvider}
        onNavigate={navigateTo}
        onPoseProviderChange={setPoseProvider}
      />
      <section className="page-shell">
        {view === "batch" && (
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
        )}
        {view === "batchJobs" && (
          <BatchJobsPage
            scenes={scenes}
            jobs={jobs}
            poseProvider={poseProvider}
            onJobCreated={(job) => setJobs((current) => [job, ...current])}
            onJobUpdated={updateJob}
          />
        )}
        {view === "viewTest" && <ViewTestPage poseProvider={poseProvider} />}
        {view === "sceneList" && (
          <SceneListPage
            scenes={scenes}
            presets={presets}
            onSave={(nextScenes) => void saveScenes(nextScenes)}
          />
        )}
        {view === "presetList" && (
          <PresetListPage
            allTags={allTags}
            presets={presets}
            onAdd={addPreset}
            onDuplicate={duplicatePreset}
            onEdit={openEditor}
            onRemove={removePreset}
            poseProvider={poseProvider}
          />
        )}
        {view === "presetEditor" && editingPreset && (
          <PresetEditorPage
            preset={editingPreset}
            allTags={allTags}
            poseProvider={poseProvider}
            onBack={() => navigateTo("presetList")}
            onUpdate={updatePreset}
          />
        )}
      </section>
    </main>
  );
}
