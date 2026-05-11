import type { ProcessResponse } from "../types";
import { viewAngleLabels } from "../constants";

export function ResultOverview({ result }: { result: ProcessResponse }) {
  return (
    <div className="overview">
      <h2>{result.filename}</h2>
      <p>
        原图 {result.source.width}x{result.source.height} · {viewAngleLabels[result.viewAngle]} · {result.keypoints.length} 个节点 · {result.crops.length} 张输出
      </p>
      <div className="preview-strip">
        {result.crops.map((crop) => (
          <img key={crop.presetId} src={`data:image/png;base64,${crop.image}`} alt={crop.name} />
        ))}
      </div>
    </div>
  );
}
