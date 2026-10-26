import { TaskPriority, TaskStatus } from '../../database/enums';
import type { MilestoneStatus } from '@tema/shared-types';

export class MilestoneUserDto {
  id!: string;
  name!: string;
  email?: string;
  avatarUrl?: string | null;
}

export class MilestoneSummaryDto {
  id!: string;
  projectId!: string;
  name!: string;
  description!: string | null;
  dueDate!: string;
  completedAt!: string | null;
  completedById!: string | null;
  completedBy?: MilestoneUserDto | null;
  createdBy!: string;
  creator?: MilestoneUserDto;
  createdAt!: string;
  updatedAt!: string;
  status!: MilestoneStatus;
  taskCount!: number;
  completedTaskCount!: number;
  progress!: number;
}

export class MilestoneTaskDto {
  id!: string;
  title!: string;
  slug?: string;
  status!: TaskStatus;
  priority!: TaskPriority;
  startDate!: string | null;
  dueDate!: string | null;
  parentTaskId!: string | null;
  assignedTo!: MilestoneUserDto | null;
  assignedToId?: string | null;
  createdBy?: string;
  subtaskCount?: number;
  completedSubtaskCount?: number;
}

export class MilestoneDetailDto extends MilestoneSummaryDto {
  tasks!: MilestoneTaskDto[];
}
