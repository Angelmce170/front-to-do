type Props = {
  value: number;
  onChange: (value: number) => void;
};

const presetLimits = Array.from({ length: 10 }, (_, index) => index + 1);

export default function ParticipantLimitField({ value, onChange }: Props) {
  const selectValue = presetLimits.includes(value) ? String(value) : "custom";

  return (
    <div className="participant-limit-field">
      <label className="field">
        <span>Límite de participantes</span>
        <select
          value={selectValue}
          onChange={(event) => {
            if (event.target.value === "custom") {
              onChange(value > 10 ? value : 11);
              return;
            }

            onChange(Number(event.target.value));
          }}
        >
          {presetLimits.map((limit) => (
            <option key={limit} value={limit}>
              {limit}
            </option>
          ))}
          <option value="custom">Otro</option>
        </select>
      </label>

      {selectValue === "custom" && (
        <label className="field">
          <span>Número personalizado</span>
          <input
            type="number"
            min={1}
            max={50}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </label>
      )}
    </div>
  );
}
