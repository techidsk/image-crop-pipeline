import type { CropPreset } from "../types";

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
