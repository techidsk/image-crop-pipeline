import type {
  BatchJob,
  CropPreset,
  CropScene,
  ExportSettings,
  ModelHealthStatus,
  ModelRepairResponse,
  ProcessResponse
} from "../types";

export async function fetchPresets() {
  const response = await fetch("/api/presets");
  if (!response.ok) throw new Error("预设加载失败");
  return (await response.json()) as CropPreset[];
}

export async function persistPresets(presets: CropPreset[]) {
  const response = await fetch("/api/presets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(presets)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "预设保存失败");
  }
  return (await response.json()) as CropPreset[];
}

export async function fetchScenes() {
  const response = await fetch("/api/scenes");
  if (!response.ok) throw new Error("场景加载失败");
  return (await response.json()) as CropScene[];
}

export async function persistScenes(scenes: CropScene[]) {
  const response = await fetch("/api/scenes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scenes)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "场景保存失败");
  }
  return (await response.json()) as CropScene[];
}

export async function fetchExportSettings() {
  const response = await fetch("/api/export-settings");
  if (!response.ok) throw new Error("导出设置加载失败");
  return (await response.json()) as ExportSettings;
}

export async function persistExportSettings(settings: ExportSettings) {
  const response = await fetch("/api/export-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "导出设置保存失败");
  }
  return (await response.json()) as ExportSettings;
}

export async function fetchBatchJobs() {
  const response = await fetch("/api/batch-jobs");
  if (!response.ok) throw new Error("任务记录加载失败");
  return (await response.json()) as BatchJob[];
}

export async function fetchBatchJobDetail(jobId: string) {
  const response = await fetch(`/api/batch-jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) throw new Error("任务详情加载失败");
  return (await response.json()) as { job: BatchJob; images: ProcessResponse[] };
}

export type ServerConfig = {
  features: { openOutputDir: boolean };
};

export async function fetchServerConfig() {
  const response = await fetch("/api/server-config");
  if (!response.ok) throw new Error("服务端配置加载失败");
  return (await response.json()) as ServerConfig;
}

export async function fetchModelHealth() {
  const response = await fetch("/api/model-health");
  if (!response.ok) throw new Error("模型健康状态加载失败");
  return (await response.json()) as ModelHealthStatus;
}

export async function repairModelHealth() {
  const response = await fetch("/api/model-health/repair", { method: "POST" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "模型修复失败");
  }
  return (await response.json()) as ModelRepairResponse;
}

export type StorageCollectionStatus = {
  status: "synced" | "pending" | "unknown";
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type StorageStatus = {
  provider: "file" | "oss";
  cloudSync: boolean;
  bucket?: string;
  collections: Record<string, StorageCollectionStatus>;
};

export async function fetchStorageStatus() {
  const response = await fetch("/api/storage/status");
  if (!response.ok) throw new Error("存储状态加载失败");
  return (await response.json()) as StorageStatus;
}

export async function triggerStorageSync() {
  const response = await fetch("/api/storage/sync", { method: "POST" });
  if (!response.ok) throw new Error("云端同步失败");
  return (await response.json()) as StorageStatus;
}
