import { SaveOutlined } from "@ant-design/icons";
import { App, Button, Card, Flex, InputNumber, Radio, Slider, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { fetchExportSettings, persistExportSettings } from "../api/presets";
import type { ExportSettings } from "../types";

const { Title, Text } = Typography;

export function SettingsPage() {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<ExportSettings>({ format: "png", quality: 100 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setSettings(await fetchExportSettings());
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "导出设置加载失败");
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      setSettings(await persistExportSettings(settings));
      void message.success("导出设置已保存");
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "导出设置保存失败");
    } finally {
      setSaving(false);
    }
  };

  const updateQuality = (quality: number | null) => {
    setSettings((current) => ({
      ...current,
      quality: Math.max(1, Math.min(100, quality ?? 100))
    }));
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <Card
        size="small"
        loading={loading}
        title={
          <Flex vertical gap={2}>
            <Title level={5} style={{ margin: 0 }}>导出设置</Title>
            <Text type="secondary">配置后续裁切结果保存和下载使用的图片格式</Text>
          </Flex>
        }
        extra={
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveSettings}>
            保存
          </Button>
        }
      >
        <Space orientation="vertical" size={18} style={{ width: "100%" }}>
          <Flex vertical gap={8}>
            <Text strong>导出格式</Text>
            <Radio.Group
              value={settings.format}
              onChange={(event) =>
                setSettings((current) => ({ ...current, format: event.target.value }))
              }
              optionType="button"
              buttonStyle="solid"
              options={[
                { label: "PNG", value: "png" },
                { label: "JPEG", value: "jpeg" }
              ]}
            />
          </Flex>

          <Flex vertical gap={8}>
            <Flex align="center" justify="space-between" gap={12}>
              <Text strong>JPEG 压缩率</Text>
              <InputNumber
                min={1}
                max={100}
                value={settings.quality}
                addonAfter="%"
                onChange={updateQuality}
                style={{ width: 120 }}
              />
            </Flex>
            <Slider
              min={1}
              max={100}
              value={settings.quality}
              marks={{ 1: "1", 50: "50", 100: "100" }}
              onChange={updateQuality}
            />
            <Text type="secondary">
              当前值为 {settings.quality}。PNG 输出会保持无损，JPEG 输出会按此值保存。
            </Text>
          </Flex>
        </Space>
      </Card>
    </div>
  );
}
