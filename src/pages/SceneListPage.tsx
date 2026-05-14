import { Copy, Plus, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CropPreset, CropScene } from "../types";

type SceneListPageProps = {
  scenes: CropScene[];
  presets: CropPreset[];
  onSave: (scenes: CropScene[]) => void;
};

export function SceneListPage({ scenes, presets, onSave }: SceneListPageProps) {
  const [selectedSceneId, setSelectedSceneId] = useState(scenes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [presetQuery, setPresetQuery] = useState("");
  const [activePresetTags, setActivePresetTags] = useState<string[]>([]);
  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0],
    [scenes, selectedSceneId]
  );
  const sceneTags = useMemo(
    () => Array.from(new Set(scenes.flatMap((scene) => scene.tags))).sort(),
    [scenes]
  );
  const presetTags = useMemo(
    () => Array.from(new Set(presets.flatMap((preset) => preset.tags ?? []))).sort(),
    [presets]
  );
  const visibleScenes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return scenes.filter((scene) => {
      const searchableText = [
        scene.name,
        scene.brand,
        scene.description,
        scene.status,
        scene.tags.join(" ")
      ].join(" ").toLowerCase();
      const matchesQuery = !normalizedQuery || searchableText.includes(normalizedQuery);
      const matchesTags = activeTags.every((tag) => scene.tags.includes(tag));

      return matchesQuery && matchesTags;
    });
  }, [activeTags, query, scenes]);
  const visiblePresets = useMemo(() => {
    const normalizedQuery = presetQuery.trim().toLowerCase();

    return presets.filter((preset) => {
      const presetTags = preset.tags ?? [];
      const searchableText = [
        preset.name,
        preset.id,
        preset.status,
        preset.note,
        preset.width,
        preset.height,
        presetTags.join(" ")
      ].join(" ").toLowerCase();
      const matchesQuery = !normalizedQuery || searchableText.includes(normalizedQuery);
      const matchesTags = activePresetTags.every((tag) => presetTags.includes(tag));

      return matchesQuery && matchesTags;
    });
  }, [activePresetTags, presetQuery, presets]);

  useEffect(() => {
    if (!selectedScene && scenes[0]) setSelectedSceneId(scenes[0].id);
  }, [scenes, selectedScene]);

  const addScene = () => {
    const id = `scene-${Date.now()}`;
    setSelectedSceneId(id);
    onSave([
      ...scenes,
      {
        id,
        name: "新品牌场景",
        brand: "",
        tags: ["draft"],
        description: "",
        presetIds: [],
        presets: [],
        status: "draft"
      }
    ]);
  };

  const updateScene = (id: string, patch: Partial<CropScene>) => {
    onSave(scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)));
  };

  const removeScene = (id: string) => {
    onSave(scenes.filter((scene) => scene.id !== id));
  };

  const duplicateScene = (scene: CropScene) => {
    const id = `${scene.id}-copy-${Date.now()}`;
    setSelectedSceneId(id);
    onSave([...scenes, { ...scene, id, name: `${scene.name} 副本` }]);
  };

  const togglePreset = (scene: CropScene, presetId: string) => {
    const presetIds = scene.presetIds.includes(presetId)
      ? scene.presetIds.filter((id) => id !== presetId)
      : [...scene.presetIds, presetId];
    const bindings = presetIds.map((id) => scene.presets.find((item) => item.presetId === id) ?? { presetId: id, enabled: true, alias: "" });
    updateScene(scene.id, { presetIds, presets: bindings });
  };

  const togglePresetTag = (scene: CropScene, tag: string) => {
    const taggedPresetIds = presets.filter((preset) => (preset.tags ?? []).includes(tag)).map((preset) => preset.id);
    if (taggedPresetIds.length === 0) return;

    const taggedPresetSet = new Set(taggedPresetIds);
    const hasEveryTaggedPreset = taggedPresetIds.every((id) => scene.presetIds.includes(id));
    const presetIds = hasEveryTaggedPreset
      ? scene.presetIds.filter((id) => !taggedPresetSet.has(id))
      : Array.from(new Set([...scene.presetIds, ...taggedPresetIds]));
    const bindings = presetIds.map((id) => scene.presets.find((item) => item.presetId === id) ?? { presetId: id, enabled: true, alias: "" });

    updateScene(scene.id, { presetIds, presets: bindings });
  };

  const clearSceneFilters = () => {
    setQuery("");
    setActiveTags([]);
  };

  const clearPresetFilters = () => {
    setPresetQuery("");
    setActivePresetTags([]);
  };

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <h2>场景管理</h2>
          <p>为品牌编排一组裁切预设，并用标签支持运营检索</p>
        </div>
        <Button type="button" onClick={addScene}>
          <Plus size={17} />
          <span>新建场景</span>
        </Button>
      </div>

      <div className="management-tools">
        <div className="input-with-icon">
          <Search size={16} />
          <Input
            value={query}
            placeholder="搜索场景名称、品牌、标签、状态或说明"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="tag-filter">
          {sceneTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={activeTags.includes(tag) ? "active" : ""}
              onClick={() =>
                setActiveTags((current) =>
                  current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
                )
              }
            >
              {tag}
            </button>
          ))}
          {(query || activeTags.length > 0) && (
            <button type="button" className="ghost-chip" onClick={clearSceneFilters}>
              清除筛选
            </button>
          )}
        </div>
      </div>

      <div className="scene-workspace">
        <div className="scene-list-panel">
          <div className="scene-list-header">
            <strong>场景列表</strong>
            <span>{visibleScenes.length} / {scenes.length} 个</span>
          </div>
          <div className="preset-table-shell">
            <table className="preset-data-table scene-table">
              <thead>
                <tr>
                  <th>场景</th>
                  <th>品牌</th>
                  <th>预设</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {visibleScenes.map((scene) => (
                  <tr
                    key={scene.id}
                    className={selectedScene?.id === scene.id ? "selected" : ""}
                    onClick={() => setSelectedSceneId(scene.id)}
                  >
                    <td>
                      <strong>{scene.name}</strong>
                      <span>{scene.tags.join(", ") || "无标签"}</span>
                    </td>
                    <td>{scene.brand || "未设置"}</td>
                    <td>{scene.presetIds.length}</td>
                    <td>
                      <span className={`status-pill ${scene.status === "active" ? "ready" : scene.status === "archived" ? "" : "incomplete"}`}>
                        {scene.status === "active" ? "启用" : scene.status === "archived" ? "归档" : "草稿"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleScenes.length === 0 && (
              <div className="empty-state compact">{scenes.length === 0 ? "暂无场景" : "没有匹配的场景"}</div>
            )}
          </div>
        </div>

        {selectedScene && (
          <article className="scene-detail-panel">
            <div className="scene-detail-head">
              <div>
                <span>当前编辑</span>
                <h2>{selectedScene.name}</h2>
              </div>
              <div className="row-actions">
                <Button type="button" variant="secondary" size="icon" className="icon-button" title="复制" onClick={() => duplicateScene(selectedScene)}>
                  <Copy size={15} />
                </Button>
                <Button type="button" variant="secondary" size="icon" className="icon-button danger" title="删除" onClick={() => removeScene(selectedScene.id)}>
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>

            <div className="scene-form-grid">
              <div className="form-field">
                <Label htmlFor={`scene-name-${selectedScene.id}`}>场景名称</Label>
                <Input id={`scene-name-${selectedScene.id}`} value={selectedScene.name} onChange={(event) => updateScene(selectedScene.id, { name: event.target.value })} />
              </div>
              <div className="form-field">
                <Label htmlFor={`scene-brand-${selectedScene.id}`}>品牌</Label>
                <Input id={`scene-brand-${selectedScene.id}`} value={selectedScene.brand} onChange={(event) => updateScene(selectedScene.id, { brand: event.target.value })} />
              </div>
              <div className="form-field">
                <Label htmlFor={`scene-tags-${selectedScene.id}`}>标签</Label>
                <Input
                  id={`scene-tags-${selectedScene.id}`}
                  value={selectedScene.tags.join(", ")}
                  onChange={(event) =>
                    updateScene(selectedScene.id, {
                      tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean)
                    })
                  }
                />
              </div>
              <div className="form-field">
                <Label htmlFor={`scene-status-${selectedScene.id}`}>状态</Label>
                <select
                  id={`scene-status-${selectedScene.id}`}
                  className="scene-status-select"
                  value={selectedScene.status}
                  onChange={(event) => updateScene(selectedScene.id, { status: event.target.value as CropScene["status"] })}
                >
                  <option value="draft">草稿</option>
                  <option value="active">启用</option>
                  <option value="archived">归档</option>
                </select>
              </div>
            </div>
            <div className="form-field">
              <Label htmlFor={`scene-description-${selectedScene.id}`}>说明</Label>
              <Textarea
                id={`scene-description-${selectedScene.id}`}
                value={selectedScene.description}
                onChange={(event) => updateScene(selectedScene.id, { description: event.target.value })}
              />
            </div>

            <div className="scene-preset-list">
              <div className="sample-list-header">
                <strong>绑定预设</strong>
                <span>{selectedScene.presetIds.length} 已绑定 · {visiblePresets.length} / {presets.length} 可见</span>
              </div>
              <div className="preset-binding-tools">
                <div className="input-with-icon">
                  <Search size={16} />
                  <Input
                    value={presetQuery}
                    placeholder="搜索预设名称、ID、尺寸、标签、状态或说明"
                    onChange={(event) => setPresetQuery(event.target.value)}
                  />
                </div>
                <div className="tag-filter">
                  {presetTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={activePresetTags.includes(tag) ? "active" : ""}
                      onClick={() =>
                        setActivePresetTags((current) =>
                          current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
                        )
                      }
                    >
                      {tag}
                    </button>
                  ))}
                  {(presetQuery || activePresetTags.length > 0) && (
                    <button type="button" className="ghost-chip" onClick={clearPresetFilters}>
                      清除筛选
                    </button>
                  )}
                </div>
              </div>
              <div className="preset-tag-binding">
                <span>按预设标签绑定</span>
                <div className="tag-filter">
                  {presetTags.map((tag) => {
                    const taggedPresets = presets.filter((preset) => (preset.tags ?? []).includes(tag));
                    const isActive = taggedPresets.length > 0 && taggedPresets.every((preset) => selectedScene.presetIds.includes(preset.id));

                    return (
                      <button
                        key={tag}
                        type="button"
                        className={isActive ? "active" : ""}
                        onClick={() => togglePresetTag(selectedScene, tag)}
                      >
                        {tag}
                        <small>{taggedPresets.length}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="scene-preset-grid">
                {visiblePresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={selectedScene.presetIds.includes(preset.id) ? "active" : ""}
                    onClick={() => togglePreset(selectedScene, preset.id)}
                  >
                    <span>
                      <strong>{preset.name}</strong>
                      <small>{preset.width}x{preset.height} · {(preset.tags ?? []).join(", ")}</small>
                    </span>
                  </button>
                ))}
              </div>
              {visiblePresets.length === 0 && (
                <div className="empty-state compact">{presets.length === 0 ? "暂无预设" : "没有匹配的预设"}</div>
              )}
            </div>
          </article>
        )}
      </div>
      <div className="floating-save-note">
        <Save size={15} />
        <span>编辑会自动保存到后端 JSON</span>
      </div>
    </section>
  );
}
