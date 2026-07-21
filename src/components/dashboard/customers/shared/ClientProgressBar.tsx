interface ClientProgressBarProps {
  progress: number;
  label?: string;
  className?: string;
}

export function ClientProgressBar({ progress, label, className = '' }: ClientProgressBarProps) {
  return (
    <div className={className}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-body text-[13px] text-muted-foreground">{label}</span>
          <span className="font-mono-data text-[13px] font-bold text-primary">{progress}%</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    </div>
  );
}
