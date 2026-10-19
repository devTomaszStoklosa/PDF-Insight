interface ProgressBarProps {
  readonly label: string;
  /** Completed fraction from 0 to 1; omit while the duration is unknown. */
  readonly value?: number;
}

export function ProgressBar({ label, value }: ProgressBarProps) {
  if (value === undefined) {
    return (
      <div className="progress progress--indeterminate" role="progressbar" aria-label={label}>
        <div className="progress__bar" />
      </div>
    );
  }

  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="progress__bar" style={{ width: `${String(percent)}%` }} />
    </div>
  );
}
