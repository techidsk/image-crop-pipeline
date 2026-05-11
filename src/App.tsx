import { useEffect, useMemo, useState } from "react";
import { fetchBatchJobs, fetchPresets, fetchScenes, persistPresets, persistScenes } from "./api/presets";
import { Sidebar } from "./components/Sidebar";
import { defaultPresets } from "./constants";
import { BatchPage } from "./pages/BatchPage";
import { BatchJobsPage } from "./pages/BatchJobsPage";
import { PresetEditorPage } from "./pages/PresetEditorPage";
import { PresetListPage } from "./pages/PresetListPage";
import { SceneListPage } from "./pages/SceneListPage";
import type { AppView, BatchJob, CropPreset, CropScene, PoseProviderId } from "./types";

export function App() {
  const [view, setView] = useState<AppView>("batch");
  const [presets, setPresets] = useState<CropPreset[]>(defaultPresets);
  const [scenes, setScenes] = useState<CropScene[]>([]);
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [poseProvider, setPoseProvider] = useState<PoseProviderId>("rtmw");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [editingPresetId, setEditingPresetId] = useState(defaultPresets[0].id);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadPresets();
    void loadScenes();
    void loadJobs();
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
      status: "draft",
      note: ""
    };
    setEditingPresetId(id);
    setView("presetEditor");
    void savePresets([...presets, nextPreset]).catch((err) =>
      setError(err instanceof Error ? err.message : "预设保存失败")
    );
  };

  const duplicatePreset = (preset: CropPreset) => {
    const copy = { ...preset, id: `${preset.id}-copy-${Date.now()}`, name: `${preset.name} 副本` };
    setEditingPresetId(copy.id);
    setView("presetEditor");
    void savePresets([...presets, copy]).catch((err) =>
      setError(err instanceof Error ? err.message : "预设保存失败")
    );
  };

  const removePreset = (id: string) => {
    const nextPresets = presets.filter((preset) => preset.id !== id);
    if (editingPresetId === id) {
      setEditingPresetId(nextPresets[0]?.id ?? "");
      setView("presetList");
    }
    void savePresets(nextPresets).catch((err) =>
      setError(err instanceof Error ? err.message : "预设保存失败")
    );
  };

  const openEditor = (id: string) => {
    setEditingPresetId(id);
    setView("presetEditor");
  };

  return (
    <main className="app-shell">
      <Sidebar
        view={view}
        error={error}
        poseProvider={poseProvider}
        onNavigate={setView}
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
          />
        )}
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
            poseProvider={poseProvider}
            onBack={() => setView("presetList")}
            onUpdate={updatePreset}
          />
        )}
      </section>
    </main>
  );
}
