interface MilestoneProgressBarProps {
  progress: number;
  completedTasks: number;
  totalTasks: number;
  showText?: boolean;
  className?: string;
}

export function MilestoneProgressBar({
  progress,
  completedTasks,
  totalTasks,
  showText = true,
  className = '',
}: MilestoneProgressBarProps) {
  const clampedProgress = Math.min(100, Math.max(0, Math.round(progress)));

  return (
    <div className={`w-full ${className}`}>
      {showText && (
        <div className="flex items-center justify-between text-xs text-[#607185] mb-1.5">
          <span>{`${completedTasks} de ${totalTasks} tareas completadas`}</span>
          <span className="font-semibold text-[#172B42]">{`${clampedProgress}%`}</span>
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[#E5E9EB]"
        role="progressbar"
        aria-valuenow={clampedProgress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progreso del hito: ${clampedProgress}%`}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            clampedProgress === 100 ? 'bg-emerald-600' : 'bg-[#245B78]'
          }`}
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
    </div>
  );
}
