import { useMemo, useState } from "react";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  CloudOutlined,
  ExperimentOutlined,
  EyeOutlined,
  ScissorOutlined,
  ShopOutlined,
  SyncOutlined
} from "@ant-design/icons";
import { Alert, Button, Flex, Layout, Menu, Select, Space, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import type { StorageStatus } from "../api/presets";
import type { AppView, PoseProviderId } from "../types";

const { Sider } = Layout;
const { Text } = Typography;

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

const STATUS_COLORS: Record<string, string> = {
  synced: "green",
  pending: "gold",
  unknown: "default"
};

export function Sidebar({
  view,
  error,
  poseProvider,
  storageStatus,
  onNavigate,
  onPoseProviderChange,
  onSyncStorage
}: SidebarProps) {
  const menuItems = useMemo<MenuProps["items"]>(
    () => [
      {
        key: "workflow",
        type: "group",
        label: "工作流",
        children: [
          { key: "batchJobs", icon: <ApartmentOutlined />, label: "Pipeline 任务" },
          { key: "batch", icon: <ScissorOutlined />, label: "单批次试跑" }
        ]
      },
      {
        key: "config",
        type: "group",
        label: "配置模块",
        children: [
          { key: "sceneList", icon: <ShopOutlined />, label: "场景 / 品牌" },
          { key: "presetList", icon: <AppstoreOutlined />, label: "裁切预设" }
        ]
      },
      {
        key: "diagnostics",
        type: "group",
        label: "诊断工具",
        children: [
          { key: "viewTest", icon: <EyeOutlined />, label: "视角测试" },
          { key: "modelHealth", icon: <ExperimentOutlined />, label: "模型健康" }
        ]
      }
    ],
    []
  );

  const selectedKey = view === "presetEditor" ? "presetList" : view;

  return (
    <Sider
      width={240}
      theme="light"
      style={{
        minHeight: "100vh",
        position: "sticky",
        top: 0,
        overflow: "auto",
        height: "100vh",
        borderRight: "1px solid #e6ebe6",
        background: "#ffffff"
      }}
    >
      <Flex vertical style={{ height: "100%" }}>
        <Flex
          vertical
          gap={2}
          style={{ borderBottom: "1px solid #eef1ee", padding: "16px", lineHeight: 1.25 }}
        >
          <Text strong>批量工具</Text>
          <Text type="secondary" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            {__APP_VERSION__} · {__APP_COMMIT__}
          </Text>
        </Flex>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => onNavigate(key as AppView)}
          style={{ borderInlineEnd: "none", flex: 1 }}
        />

        <Flex vertical gap={12} style={{ borderTop: "1px solid #eef1ee", padding: "12px" }}>
          {storageStatus?.cloudSync && (
            <StorageStatusPanel storageStatus={storageStatus} onSyncStorage={onSyncStorage} />
          )}

          <Flex vertical gap={4}>
            <Text type="secondary">姿态引擎</Text>
            <Select
              value={poseProvider}
              size="small"
              onChange={(value) => onPoseProviderChange(value)}
              options={[
                { value: "rtmw", label: "RTMW-l ONNX" },
                { value: "heuristic", label: "旧方案 / Heuristic" }
              ]}
            />
          </Flex>

          {error && <Alert type="error" showIcon message={error} style={{ padding: "4px 8px" }} />}
        </Flex>
      </Flex>
    </Sider>
  );
}

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
    <div
      style={{
        borderRadius: 6,
        border: "1px solid #e6ebe6",
        background: "#fafbfa",
        padding: 8
      }}
    >
      <Flex align="center" justify="space-between" style={{ marginBottom: 4 }}>
        <Space size={4}>
          <CloudOutlined style={{ color: "#1c6b62" }} />
          <Text strong>云端同步</Text>
        </Space>
        <Button
          size="small"
          type="text"
          icon={<SyncOutlined spin={syncing} />}
          onClick={() => void handleSync()}
          disabled={syncing}
        >
          {syncing ? "同步中" : "立即同步"}
        </Button>
      </Flex>
      <Space orientation="vertical" size={2} style={{ width: "100%" }}>
        {Object.entries(storageStatus.collections).map(([name, info]) => (
          <Flex key={name} align="center" justify="space-between" title={info.lastError ?? ""}>
            <Text type="secondary">{COLLECTION_LABELS[name] ?? name}</Text>
            <Tag color={STATUS_COLORS[info.status]} style={{ marginInlineEnd: 0 }}>
              {STATUS_LABELS[info.status] ?? info.status}
            </Tag>
          </Flex>
        ))}
      </Space>
    </div>
  );
}
