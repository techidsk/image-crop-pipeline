type NumberFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
};

export function NumberField({ label, value, onChange, step = 1, min }: NumberFieldProps) {
  return (
    <label>
      {label}
      <input type="number" value={value} step={step} min={min} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
