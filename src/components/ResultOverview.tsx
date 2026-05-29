import { Button, Flex, Image, Space, Tag, Typography } from "antd";
import type { ProcessResponse } from "../types";
import { viewAngleLabels } from "../constants";

const { Title } = Typography;

type ResultOverviewProps = {
  result: ProcessResponse;
  onOpenPreset?: (presetId: string) => void;
};

export function ResultOverview({ result, onOpenPreset }: ResultOverviewProps) {
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
            <Flex key={crop.presetId} vertical gap={4} style={{ width: 120 }}>
              <Image
                src={`data:${crop.mimeType ?? "image/png"};base64,${crop.image}`}
                alt={crop.name}
                width={120}
                style={{ objectFit: "cover", borderRadius: 6 }}
              />
              {onOpenPreset ? (
                <Button
                  type="link"
                  size="small"
                  style={{ height: "auto", padding: 0, justifyContent: "flex-start" }}
                  onClick={() => onOpenPreset(crop.presetId)}
                >
                  {crop.name}
                </Button>
              ) : (
                <Typography.Text ellipsis style={{ fontSize: 12 }}>{crop.name}</Typography.Text>
              )}
            </Flex>
          ))}
        </Flex>
      </Image.PreviewGroup>
    </Flex>
  );
}
