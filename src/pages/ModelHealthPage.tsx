import { useEffect, useState } from "react";
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined, ToolOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Descriptions, Empty, Flex, List, Space, Spin, Tag, Typography } from "antd";
import { fetchModelHealth, repairModelHealth } from "../api/presets";
import type { ModelHealthStatus, ModelRepairAction } from "../types";

const { Title, Text } = Typography;

export function ModelHealthPage() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<ModelHealthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairActions, setRepairActions] = useState<ModelRepairAction[]>([]);
  const [error, setError] = useState("");

  const loadStatus = async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await fetchModelHealth());
    } catch (err) {
      const nextError = err instanceof Error ? err.message : "模型健康状态加载失败";
      setError(nextError);
      void message.error(nextError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const repairStatus = async () => {
    setRepairing(true);
    setError("");
    try {
      const result = await repairModelHealth();
      setRepairActions(result.actions);
      setStatus(result.health);
      const needsManual = result.actions.some((action) => action.status === "manual_required" || action.status === "failed");
      if (needsManual) {
        void message.warning("部分项目需要手动处理");
      } else {
        void message.success("模型修复完成");
      }
    } catch (err) {
      const nextError = err instanceof Error ? err.message : "模型修复失败";
      setError(nextError);
      void message.error(nextError);
    } finally {
      setRepairing(false);
    }
  };

  if (loading && !status) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: 420 }}>
        <Spin tip="检查模型状态" />
      </Flex>
    );
  }

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap="wrap" gap={12}>
        <Space direction="vertical" size={2}>
          <Title level={3} style={{ margin: 0 }}>模型健康检查</Title>
          <Text type="secondary">确认当前后端进程实际加载的姿态模型和视角模型</Text>
        </Space>
        <Space>
          <Button icon={<ToolOutlined />} type="primary" onClick={() => void repairStatus()} loading={repairing}>
            修复
          </Button>
          <Button icon={<ReloadOutlined spin={loading} />} onClick={() => void loadStatus()} disabled={loading || repairing}>
            刷新
          </Button>
        </Space>
      </Flex>

      {error && <Alert type="error" showIcon message={error} />}
      {repairActions.length > 0 && (
        <Card size="small" title="修复结果">
          <List
            size="small"
            dataSource={repairActions}
            renderItem={(action) => (
              <List.Item>
                <Space>
                  <RepairTag status={action.status} />
                  <Text strong>{repairTargetLabel(action.target)}</Text>
                  <Text type={action.status === "failed" ? "danger" : "secondary"}>{action.message}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}

      {status ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <StatusSummaryCard
              title="姿态引擎"
              ok={status.pose.rtmw.loaded}
              value={status.pose.activeDefault}
              detail={status.pose.rtmw.loaded ? "RTMW 已加载" : "已回退到 Heuristic"}
            />
            <StatusSummaryCard
              title="Paddle 视角"
              ok={status.view.paddle.ready}
              value={status.view.paddle.ready ? "可用" : "不可用"}
              detail={`阈值 ${(status.view.paddle.confirmConfidence * 100).toFixed(0)}%`}
            />
            <StatusSummaryCard
              title="DensePose"
              ok={status.view.densepose.ready}
              value={status.view.densepose.ready ? "可用" : "未启用"}
              detail={status.view.densepose.enabled ? "已配置为候选" : "未进入视角链路"}
              soft
            />
          </div>

          <Card size="small" title="姿态模型 RTMW">
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="请求默认">{status.pose.requestedDefault}</Descriptions.Item>
              <Descriptions.Item label="实际默认">
                <HealthTag ok={status.pose.activeDefault === "rtmw"} label={status.pose.activeDefault} />
              </Descriptions.Item>
              <Descriptions.Item label="可用 Provider">{status.pose.availableProviders.join(", ")}</Descriptions.Item>
              <Descriptions.Item label="模型加载">
                <HealthTag ok={status.pose.rtmw.loaded} label={status.pose.rtmw.loaded ? "已加载" : "未加载"} />
              </Descriptions.Item>
              <Descriptions.Item label="模型文件">{status.pose.rtmw.configuredPath}</Descriptions.Item>
              <Descriptions.Item label="文件状态">
                <HealthTag
                  ok={status.pose.rtmw.modelExists}
                  label={status.pose.rtmw.modelExists ? formatBytes(status.pose.rtmw.modelSize) : "不存在"}
                />
              </Descriptions.Item>
              <Descriptions.Item label="输入尺寸">
                {status.pose.rtmw.inputWidth} x {status.pose.rtmw.inputHeight}
              </Descriptions.Item>
              <Descriptions.Item label="自动下载">
                {status.pose.rtmw.autoDownload} / required {status.pose.rtmw.downloadRequired}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card size="small" title="视角模型链路">
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="启用顺序">{status.view.providerOrder.join(" -> ") || "无"}</Descriptions.Item>
              <Descriptions.Item label="高置信 Paddle 阈值">
                {(status.view.paddle.confirmConfidence * 100).toFixed(0)}%
              </Descriptions.Item>
              <Descriptions.Item label="Paddle 依赖">
                <HealthTag ok={status.view.paddle.dependencyAvailable} label={status.view.paddle.dependencyAvailable ? "已安装" : "缺失"} />
              </Descriptions.Item>
              <Descriptions.Item label="Paddle 模型">
                <HealthTag ok={status.view.paddle.ready} label={status.view.paddle.ready ? "可用" : "不可用"} />
              </Descriptions.Item>
              <Descriptions.Item label="Paddle Predictor">
                <HealthTag
                  ok={status.view.paddle.predictorReady}
                  label={status.view.paddle.predictorReady ? "可初始化" : "初始化失败"}
                />
              </Descriptions.Item>
              <Descriptions.Item label="Paddle 目录">{status.view.paddle.modelDir}</Descriptions.Item>
              <Descriptions.Item label="Paddle 文件">
                model {yesNo(status.view.paddle.modelExists)} / params {yesNo(status.view.paddle.paramsExists)}
              </Descriptions.Item>
              {status.view.paddle.lastError && (
                <Descriptions.Item label="Paddle 错误" span={2}>
                  <Text type="danger">{status.view.paddle.lastError}</Text>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="DensePose 依赖">
                densepose {yesNo(status.view.densepose.denseposeAvailable)} / detectron2 {yesNo(status.view.densepose.detectron2Available)}
              </Descriptions.Item>
              <Descriptions.Item label="DensePose 状态">
                <HealthTag ok={status.view.densepose.ready} label={status.view.densepose.ready ? "可用" : "不可用"} />
              </Descriptions.Item>
              <Descriptions.Item label="DensePose config">{status.view.densepose.config.path || "未配置"}</Descriptions.Item>
              <Descriptions.Item label="DensePose weights">{status.view.densepose.weights.path || "未配置"}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card size="small" title="诊断日志">
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="日志文件">{status.diagnostics.logFile}</Descriptions.Item>
              <Descriptions.Item label="识别 Trace 标记">{status.diagnostics.analyzeTraceMarker}</Descriptions.Item>
            </Descriptions>
          </Card>
        </>
      ) : (
        <Empty description="暂无模型状态" />
      )}
    </Flex>
  );
}

function StatusSummaryCard({
  title,
  ok,
  value,
  detail,
  soft = false
}: {
  title: string;
  ok: boolean;
  value: string;
  detail: string;
  soft?: boolean;
}) {
  const color = ok ? "#1c6b62" : soft ? "#8c6d1f" : "#b42318";
  const icon = ok ? <CheckCircleOutlined /> : soft ? <WarningOutlined /> : <CloseCircleOutlined />;
  return (
    <Card size="small">
      <Flex vertical gap={8}>
        <Text type="secondary">{title}</Text>
        <Space>
          <span style={{ color, fontSize: 18 }}>{icon}</span>
          <Title level={4} style={{ margin: 0 }}>{value}</Title>
        </Space>
        <Text type="secondary">{detail}</Text>
      </Flex>
    </Card>
  );
}

function HealthTag({ ok, label }: { ok: boolean; label: string }) {
  return <Tag color={ok ? "green" : "red"}>{label}</Tag>;
}

function RepairTag({ status }: { status: string }) {
  if (status === "ok") return <Tag color="green">正常</Tag>;
  if (status === "fixed") return <Tag color="blue">已修复</Tag>;
  if (status === "manual_required") return <Tag color="gold">需手动</Tag>;
  if (status === "failed") return <Tag color="red">失败</Tag>;
  return <Tag>{status}</Tag>;
}

function repairTargetLabel(target: string) {
  if (target === "rtmw") return "RTMW";
  if (target === "paddle_model") return "Paddle 模型";
  if (target === "paddle_dependency") return "Paddle 依赖";
  return target;
}

function yesNo(value: boolean) {
  return value ? "有" : "无";
}

function formatBytes(value: number) {
  if (value <= 0) return "0 B";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
