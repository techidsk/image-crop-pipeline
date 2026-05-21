import type { BatchJob, CropPreset, CropScene } from "../types";

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

export async function fetchBatchJobs() {
  const response = await fetch("/api/batch-jobs");
  if (!response.ok) throw new Error("任务记录加载失败");
  return (await response.json()) as BatchJob[];
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
