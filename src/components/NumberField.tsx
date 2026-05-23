import { Flex, InputNumber, Typography } from "antd";

const { Text } = Typography;

type NumberFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
};

export function NumberField({ label, value, onChange, step = 1, min }: NumberFieldProps) {
  return (
    <Flex vertical gap={4}>
      <Text type="secondary">{label}</Text>
      <InputNumber
        size="small"
        value={value}
        step={step}
        min={min}
        onChange={(next) => onChange(Number(next ?? 0))}
        style={{ width: "100%" }}
      />
    </Flex>
  );
}
