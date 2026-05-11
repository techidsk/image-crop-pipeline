import { Copy, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CropPreset, CropScene } from "../types";

type SceneListPageProps = {
  scenes: CropScene[];
  presets: CropPreset[];
  onSave: (scenes: CropScene[]) => void;
};

export function SceneListPage({ scenes, presets, onSave }: SceneListPageProps) {
  const [selectedSceneId, setSelectedSceneId] = useState(scenes[0]?.id ?? "");
  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0],
    [scenes, selectedSceneId]
  );

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

  return (
    <section className="management-page">
      <div className="page-header">
        <div>
          <h2>场景管理</h2>
          <p>为品牌编排一组裁切预设，并用标签支持运营检索</p>
        </div>
        <button type="button" onClick={addScene}>
          <Plus size={17} />
          <span>新建场景</span>
        </button>
      </div>

      <div className="scene-workspace">
        <div className="scene-list-panel">
          <div className="scene-list-header">
            <strong>场景列表</strong>
            <span>{scenes.length} 个</span>
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
                {scenes.map((scene) => (
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
            {scenes.length === 0 && <div className="empty-state compact">暂无场景</div>}
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
                <button type="button" className="icon-button" title="复制" onClick={() => duplicateScene(selectedScene)}>
                  <Copy size={15} />
                </button>
                <button type="button" className="icon-button danger" title="删除" onClick={() => removeScene(selectedScene.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            <div className="scene-form-grid">
              <label>
                场景名称
                <input value={selectedScene.name} onChange={(event) => updateScene(selectedScene.id, { name: event.target.value })} />
              </label>
              <label>
                品牌
                <input value={selectedScene.brand} onChange={(event) => updateScene(selectedScene.id, { brand: event.target.value })} />
              </label>
              <label>
                标签
                <input
                  value={selectedScene.tags.join(", ")}
                  onChange={(event) =>
                    updateScene(selectedScene.id, {
                      tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean)
                    })
                  }
                />
              </label>
              <label>
                状态
                <select value={selectedScene.status} onChange={(event) => updateScene(selectedScene.id, { status: event.target.value as CropScene["status"] })}>
                  <option value="draft">草稿</option>
                  <option value="active">启用</option>
                  <option value="archived">归档</option>
                </select>
              </label>
            </div>
            <label>
              说明
              <textarea value={selectedScene.description} onChange={(event) => updateScene(selectedScene.id, { description: event.target.value })} />
            </label>

            <div className="scene-preset-list">
              <div className="sample-list-header">
                <strong>绑定预设</strong>
                <span>{selectedScene.presetIds.length} / {presets.length}</span>
              </div>
              <div className="scene-preset-grid">
                {presets.map((preset) => (
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
