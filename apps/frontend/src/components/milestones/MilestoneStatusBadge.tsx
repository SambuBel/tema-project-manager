import type { MilestoneStatus } from '@tema/shared-types';

interface MilestoneStatusBadgeProps {
  status: MilestoneStatus;
  className?: string;
}

const STATUS_CONFIG: Record<MilestoneStatus, { label: string; bg: string; text: string; border: string }> = {
  PENDING: {
    label: 'Pendiente',
    bg: 'bg-[#EAF2F7]',
    text: 'text-[#245B78]',
    border: 'border-[#DEE5EC]',
  },
  OVERDUE: {
    label: 'Vencido',
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
  },
  COMPLETED: {
    label: 'Alcanzado',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
  },
};

export function MilestoneStatusBadge({ status, className = '' }: MilestoneStatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${config.bg} ${config.text} ${config.border} ${className}`}
    >
      {config.label}
    </span>
  );
}
