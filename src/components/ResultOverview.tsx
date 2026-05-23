import { Flex, Image, Space, Tag, Typography } from "antd";
import type { ProcessResponse } from "../types";
import { viewAngleLabels } from "../constants";

const { Title } = Typography;

export function ResultOverview({ result }: { result: ProcessResponse }) {
  return (
    <Flex vertical gap={12}>
      <Flex align="flex-start" justify="space-between" gap={12}>
        <Title level={5} style={{ margin: 0 }}>{result.filename}</Title>
        <Space size={4} wrap>
          <Tag color="blue">{result.source.width}x{result.source.height}</Tag>
          <Tag color="cyan">{viewAngleLabels[result.viewAngle]}</Tag>
          <Tag>{result.keypoints.length} 节点</Tag>
          <Tag color="green">{result.crops.length} 张输出</Tag>
        </Space>
      </Flex>
      <Image.PreviewGroup>
        <Flex wrap gap={8}>
          {result.crops.map((crop) => (
            <Image
              key={crop.presetId}
              src={`data:image/png;base64,${crop.image}`}
              alt={crop.name}
              width={120}
              style={{ objectFit: "cover", borderRadius: 6 }}
            />
          ))}
        </Flex>
      </Image.PreviewGroup>
    </Flex>
  );
}
