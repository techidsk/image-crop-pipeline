import { DownloadOutlined } from "@ant-design/icons";
import { Button, Card, Flex, Image, Typography } from "antd";
import type { CropResult } from "../types";

const { Text } = Typography;

type CropCardProps = {
  filename: string;
  crop: CropResult;
  onOpenPreset?: (presetId: string) => void;
};

export function CropCard({ filename, crop, onOpenPreset }: CropCardProps) {
  const safeName = filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  const src = crop.imageUrl || (crop.image ? `data:image/png;base64,${crop.image}` : "");
  return (
    <Card
      size="small"
      styles={{ body: { padding: 8 } }}
      cover={<Image src={src} alt={crop.name} preview={{ src }} style={{ objectFit: "cover" }} />}
      actions={[
        <a key="download" href={src} download={`${safeName}_${crop.presetId}.png`} aria-label={`下载 ${crop.name}`}>
          <DownloadOutlined /> 下载
        </a>
      ]}
    >
      <Flex vertical gap={2}>
        {onOpenPreset ? (
          <Button
            type="link"
            size="small"
            style={{ alignSelf: "flex-start", height: "auto", padding: 0, fontWeight: 600 }}
            onClick={() => onOpenPreset(crop.presetId)}
          >
            {crop.name}
          </Button>
        ) : (
          <Text strong>{crop.name}</Text>
        )}
        <Text type="secondary">
          {safeName} · {crop.width}x{crop.height} · L{crop.box.left} T{crop.box.top}
        </Text>
        {crop.outputPath && (
          <Text type="secondary" ellipsis>{crop.outputPath}</Text>
        )}
      </Flex>
    </Card>
  );
}
