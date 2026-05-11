import { Download } from "lucide-react";
import type { CropResult } from "../types";

type CropCardProps = {
  filename: string;
  crop: CropResult;
};

export function CropCard({ filename, crop }: CropCardProps) {
  const safeName = filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  return (
    <article className="crop-card">
      <img src={`data:image/png;base64,${crop.image}`} alt={crop.name} />
      <div>
        <strong>{crop.name}</strong>
        <span>
          {safeName} · {crop.width}x{crop.height} · L{crop.box.left} T{crop.box.top}
        </span>
        {crop.outputPath && <span>{crop.outputPath}</span>}
      </div>
      <a href={`data:image/png;base64,${crop.image}`} download={`${safeName}_${crop.presetId}.png`} aria-label={`Download ${crop.name}`}>
        <Download size={16} />
      </a>
    </article>
  );
}
