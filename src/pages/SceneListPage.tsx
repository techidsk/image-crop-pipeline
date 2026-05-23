import { useEffect, useMemo, useState } from "react";
import { CopyOutlined, DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import {
  Badge,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { CropPreset, CropScene } from "../types";

const { Title, Text } = Typography;
const { TextArea } = Input;

type SceneListPageProps = {
  scenes: CropScene[];
  presets: CropPreset[];
  onSave: (scenes: CropScene[]) => void;
};

const STATUS_OPTIONS = [
  { label: "草稿", value: "draft" },
  { label: "启用", value: "active" },
  { label: "归档", value: "archived" }
];

const STATUS_COLORS: Record<CropScene["status"], string> = {
  draft: "gold",
  active: "green",
  archived: "default"
};

const STATUS_LABELS: Record<CropScene["status"], string> = {
  draft: "草稿",
  active: "启用",
  archived: "归档"
};

export function SceneListPage({ scenes, presets, onSave }: SceneListPageProps) {
  const [selectedSceneId, setSelectedSceneId] = useState(scenes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [presetQuery, setPresetQuery] = useState("");

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
      const tags = preset.tags ?? [];
      const searchableText = [
        preset.name,
        preset.id,
        preset.status,
        preset.note,
        preset.width,
        preset.height,
        tags.join(" ")
      ].join(" ").toLowerCase();
      return !normalizedQuery || searchableText.includes(normalizedQuery);
    });
  }, [presetQuery, presets]);

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
    const bindings = presetIds.map(
      (id) => scene.presets.find((item) => item.presetId === id) ?? { presetId: id, enabled: true, alias: "" }
    );
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
    const bindings = presetIds.map(
      (id) => scene.presets.find((item) => item.presetId === id) ?? { presetId: id, enabled: true, alias: "" }
    );
    updateScene(scene.id, { presetIds, presets: bindings });
  };

  const sceneColumns: ColumnsType<CropScene> = [
    {
      title: "场景",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (_, scene) => (
        <Flex vertical style={{ minWidth: 0 }}>
          <Text strong ellipsis={{ tooltip: scene.name }} style={{ display: "block" }}>
            {scene.name}
          </Text>
          <Text type="secondary" ellipsis style={{ fontSize: 12, display: "block" }}>
            {scene.brand ? `${scene.brand} · ` : ""}
            {scene.tags.join(", ") || "无标签"}
          </Text>
        </Flex>
      )
    },
    {
      title: "预设",
      dataIndex: "presetIds",
      key: "presetIds",
      width: 64,
      align: "center",
      render: (presetIds: string[]) => <Badge count={presetIds.length} showZero color="#1c6b62" />
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 72,
      render: (status: CropScene["status"]) => (
        <Tag color={STATUS_COLORS[status]} style={{ marginInlineEnd: 0 }}>
          {STATUS_LABELS[status]}
        </Tag>
      )
    }
  ];

  return (
    <Flex vertical gap={12}>
      <Card
        size="small"
        title={
          <Flex vertical gap={2}>
            <Title level={5} style={{ margin: 0 }}>场景管理</Title>
            <Text type="secondary">为品牌编排一组裁切预设，并用标签支持运营检索</Text>
          </Flex>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={addScene}>
            新建场景
          </Button>
        }
      >
        <Flex vertical gap={12}>
          <Input.Search
            placeholder="搜索场景名称、品牌、标签、状态或说明"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            allowClear
          />
          {sceneTags.length > 0 && (
            <Flex vertical gap={6}>
              <Flex align="center" justify="space-between">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  按标签筛选{activeTags.length > 0 ? ` · 已选 ${activeTags.length}` : ""}
                </Text>
                {activeTags.length > 0 && (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: "auto", fontSize: 12 }}
                    onClick={() => setActiveTags([])}
                  >
                    清空
                  </Button>
                )}
              </Flex>
              <Space size={[4, 4]} wrap>
                {sceneTags.map((tag) => (
                  <Tag.CheckableTag
                    key={tag}
                    checked={activeTags.includes(tag)}
                    onChange={() =>
                      setActiveTags((current) =>
                        current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
                      )
                    }
                  >
                    {tag}
                  </Tag.CheckableTag>
                ))}
              </Space>
            </Flex>
          )}
        </Flex>
      </Card>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "380px minmax(0, 1fr)" }}>
        <Card
          size="small"
          title="场景列表"
          extra={<Text type="secondary">{visibleScenes.length} / {scenes.length}</Text>}
        >
          <Table
            rowKey="id"
            size="small"
            columns={sceneColumns}
            dataSource={visibleScenes}
            pagination={false}
            scroll={{ y: 480 }}
            rowClassName={(scene) => (selectedScene?.id === scene.id ? "row-highlight" : "")}
            onRow={(scene) => ({
              onClick: () => setSelectedSceneId(scene.id),
              style: { cursor: "pointer" }
            })}
            locale={{ emptyText: <Empty description={scenes.length === 0 ? "暂无场景" : "没有匹配的场景"} /> }}
          />
        </Card>

        {selectedScene ? (
          <Card
            size="small"
            title={
              <Flex vertical gap={2}>
                <Text type="secondary">当前编辑</Text>
                <Title level={5} style={{ margin: 0 }}>{selectedScene.name}</Title>
              </Flex>
            }
            extra={
              <Space>
                <Button size="small" icon={<CopyOutlined />} onClick={() => duplicateScene(selectedScene)}>
                  复制
                </Button>
                <Popconfirm
                  title="确认删除该场景？"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => removeScene(selectedScene.id)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            }
          >
            <Flex vertical gap={16}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <Flex vertical gap={4}>
                  <Text type="secondary">场景名称</Text>
                  <Input
                    value={selectedScene.name}
                    onChange={(event) => updateScene(selectedScene.id, { name: event.target.value })}
                  />
                </Flex>
                <Flex vertical gap={4}>
                  <Text type="secondary">品牌</Text>
                  <Input
                    value={selectedScene.brand}
                    onChange={(event) => updateScene(selectedScene.id, { brand: event.target.value })}
                  />
                </Flex>
                <Flex vertical gap={4}>
                  <Text type="secondary">标签</Text>
                  <Select
                    mode="tags"
                    value={selectedScene.tags}
                    placeholder="回车添加标签"
                    onChange={(tags) => updateScene(selectedScene.id, { tags })}
                  />
                </Flex>
                <Flex vertical gap={4}>
                  <Text type="secondary">状态</Text>
                  <Segmented
                    value={selectedScene.status}
                    options={STATUS_OPTIONS}
                    onChange={(value) => updateScene(selectedScene.id, { status: value as CropScene["status"] })}
                  />
                </Flex>
              </div>
              <Flex vertical gap={4}>
                <Text type="secondary">说明</Text>
                <TextArea
                  rows={3}
                  value={selectedScene.description}
                  onChange={(event) => updateScene(selectedScene.id, { description: event.target.value })}
                />
              </Flex>

              <Card
                size="small"
                type="inner"
                title="绑定预设"
                extra={
                  <Text type="secondary">
                    {selectedScene.presetIds.length} 已绑定 · {visiblePresets.length} / {presets.length} 可见
                  </Text>
                }
              >
                <Flex vertical gap={12}>
                  <Input.Search
                    placeholder="搜索预设名称、ID、尺寸、标签、状态或说明"
                    value={presetQuery}
                    onChange={(event) => setPresetQuery(event.target.value)}
                    allowClear
                  />
                  {presetTags.length > 0 && (
                    <Flex vertical gap={6}>
                      <Text type="secondary" style={{ fontSize: 12 }}>按标签批量绑定</Text>
                      <Space size={[4, 4]} wrap>
                        {presetTags.map((tag) => {
                          const taggedPresets = presets.filter((preset) => (preset.tags ?? []).includes(tag));
                          const isActive =
                            taggedPresets.length > 0 &&
                            taggedPresets.every((preset) => selectedScene.presetIds.includes(preset.id));
                          return (
                            <Button
                              key={tag}
                              size="small"
                              type={isActive ? "primary" : "default"}
                              onClick={() => togglePresetTag(selectedScene, tag)}
                            >
                              {tag}
                              <Badge
                                count={taggedPresets.length}
                                showZero
                                color={isActive ? "rgba(255,255,255,0.3)" : "#d9d9d9"}
                                style={{ marginInlineStart: 6 }}
                              />
                            </Button>
                          );
                        })}
                      </Space>
                    </Flex>
                  )}
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))"
                    }}
                  >
                    {visiblePresets.map((preset) => {
                      const bound = selectedScene.presetIds.includes(preset.id);
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => togglePreset(selectedScene, preset.id)}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            gap: 4,
                            borderRadius: 6,
                            border: `1px solid ${bound ? "#1c6b62" : "#e6ebe6"}`,
                            background: bound ? "#e3efed" : "#ffffff",
                            padding: "8px 12px",
                            textAlign: "left",
                            fontSize: 12,
                            cursor: "pointer",
                            transition: "border-color 0.15s"
                          }}
                        >
                          <Text strong>{preset.name}</Text>
                          <Text type="secondary">
                            {preset.width}x{preset.height} · {(preset.tags ?? []).join(", ") || "无标签"}
                          </Text>
                        </button>
                      );
                    })}
                  </div>
                  {visiblePresets.length === 0 && (
                    <Empty description={presets.length === 0 ? "暂无预设" : "没有匹配的预设"} />
                  )}
                </Flex>
              </Card>
            </Flex>
          </Card>
        ) : (
          <Card size="small">
            <Empty description="选择或新建一个场景" />
          </Card>
        )}
      </div>

      <Flex align="center" justify="flex-end">
        <Tag icon={<SaveOutlined />} color="cyan">编辑会自动保存到后端 JSON</Tag>
      </Flex>
    </Flex>
  );
}
