import type { LabelFormat } from '../api/types';

/** QR / 바코드 중 하나를 고르는 버튼 묶음. */
export function LabelFormatPicker({
  value,
  onChange,
}: {
  value: LabelFormat;
  onChange(f: LabelFormat): void;
}) {
  return (
    <div className="tabs" role="group" aria-label="출력 형식">
      {(
        [
          ['qr', 'QR'],
          ['barcode', '바코드'],
        ] as const
      ).map(([f, text]) => (
        <button key={f} type="button" aria-pressed={value === f} onClick={() => onChange(f)}>
          {text}
        </button>
      ))}
    </div>
  );
}
