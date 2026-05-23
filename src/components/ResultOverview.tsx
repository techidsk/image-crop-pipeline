import { Image, Space, Tag, Typography } from "antd";
import type { ProcessResponse } from "../types";
import { viewAngleLabels } from "../constants";

const { Title, Text } = Typography;

export function ResultOverview({ result }: { result: ProcessResponse }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <Title level={5} style={{ margin: 0 }}>{result.filename}</Title>
        <Space size={4} wrap>
          <Tag color="blue">{result.source.width}x{result.source.height}</Tag>
          <Tag color="cyan">{viewAngleLabels[result.viewAngle]}</Tag>
          <Tag>{result.keypoints.length} 节点</Tag>
          <Tag color="green">{result.crops.length} 张输出</Tag>
        </Space>
      </div>
      <Image.PreviewGroup>
        <div className="flex flex-wrap gap-2">
          {result.crops.map((crop) => (
            <Image
              key={crop.presetId}
              src={`data:image/png;base64,${crop.image}`}
              alt={crop.name}
              width={120}
              style={{ objectFit: "cover", borderRadius: 6 }}
            />
          ))}
        </div>
      </Image.PreviewGroup>
    </div>
  );
}
