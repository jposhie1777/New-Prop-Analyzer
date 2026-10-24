"use client";

export function Segmented<OptionValue extends string | number>({ options, value, onChange, label }: { options: Array<{ value: OptionValue; label: string }>; value: OptionValue; onChange: (next: OptionValue) => void; label?: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} role="tab" aria-selected={option.value === value} className={option.value === value ? "active" : ""} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
