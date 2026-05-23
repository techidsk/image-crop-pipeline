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
import { Alert, Button, Layout, Menu, Select, Space, Tag, Typography } from "antd";
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
        children: [{ key: "viewTest", icon: <EyeOutlined />, label: "视角测试" }]
      }
    ],
    []
  );

  const selectedKey = view === "presetEditor" ? "presetList" : view;

  return (
    <Sider
      width={240}
      theme="light"
      className="!border-r !border-[#e6ebe6] !bg-white"
      style={{ minHeight: "100vh", position: "sticky", top: 0, overflow: "auto", height: "100vh" }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-[#eef1ee] px-4 py-4">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-[#1c6b62] font-bold text-white">
            OP
          </div>
          <div className="flex flex-col leading-tight">
            <Text strong style={{ fontSize: 15 }}>Crop Pipeline</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>Python 工作流 · React 控制台</Text>
            <Text type="secondary" className="!font-mono" style={{ fontSize: 10 }}>
              {__APP_VERSION__} · {__APP_COMMIT__}
            </Text>
          </div>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => onNavigate(key as AppView)}
          style={{ borderInlineEnd: "none", flex: 1 }}
        />

        <div className="flex flex-col gap-3 border-t border-[#eef1ee] px-3 py-3">
          {storageStatus?.cloudSync && (
            <StorageStatusPanel storageStatus={storageStatus} onSyncStorage={onSyncStorage} />
          )}

          <div className="flex flex-col gap-1">
            <Text type="secondary" style={{ fontSize: 11 }}>姿态引擎</Text>
            <Select
              value={poseProvider}
              size="small"
              onChange={(value) => onPoseProviderChange(value)}
              options={[
                { value: "rtmw", label: "RTMW-l ONNX" },
                { value: "heuristic", label: "旧方案 / Heuristic" }
              ]}
            />
          </div>

          {error && <Alert type="error" showIcon message={error} style={{ padding: "4px 8px" }} />}
        </div>
      </div>
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
    <div className="rounded-md border border-[#e6ebe6] bg-[#fafbfa] p-2">
      <div className="mb-1 flex items-center justify-between">
        <Space size={4}>
          <CloudOutlined style={{ color: "#1c6b62" }} />
          <Text strong style={{ fontSize: 12 }}>云端同步</Text>
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
      </div>
      <Space orientation="vertical" size={2} style={{ width: "100%" }}>
        {Object.entries(storageStatus.collections).map(([name, info]) => (
          <div key={name} className="flex items-center justify-between" title={info.lastError ?? ""}>
            <Text type="secondary" style={{ fontSize: 11 }}>{COLLECTION_LABELS[name] ?? name}</Text>
            <Tag color={STATUS_COLORS[info.status]} style={{ marginInlineEnd: 0, fontSize: 10 }}>
              {STATUS_LABELS[info.status] ?? info.status}
            </Tag>
          </div>
        ))}
      </Space>
    </div>
  );
}
