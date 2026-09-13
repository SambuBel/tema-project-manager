import { ProjectEntity } from '../../projects/project.entity';
import { UserEntity } from './user.entity';
import { RoleEntity } from './role.entity';
import { UserRoleEntity } from './user-role.entity';
import { ProjectStatusHistoryEntity } from './project-status-history.entity';
import { ResourceProfileEntity } from './resource-profile.entity';
import { ProjectMemberEntity } from './project-member.entity';
import { TaskEntity } from './task.entity';
import { TaskDependencyEntity } from './task-dependency.entity';
import { TagEntity } from './tag.entity';
import { TaskTagEntity } from './task-tag.entity';
import { CommentEntity } from './comment.entity';
import { AttachmentEntity } from './attachment.entity';
import { CostCategoryEntity } from './cost-category.entity';
import { BudgetEntity } from './budget.entity';
import { BudgetItemEntity } from './budget-item.entity';
import { CostEntity } from './cost.entity';
import { ExchangeRateEntity } from './exchange-rate.entity';
import { ProgressMetricEntity } from './progress-metric.entity';
import { AuditLogEntity } from './audit-log.entity';
import { NotificationEntity } from './notification.entity';
import { AiConversationEntity } from './ai-conversation.entity';
import { AiMessageEntity } from './ai-message.entity';

export * from './user.entity';
export * from './role.entity';
export * from './user-role.entity';
export * from './project-status-history.entity';
export * from './resource-profile.entity';
export * from './project-member.entity';
export * from './task.entity';
export * from './task-dependency.entity';
export * from './tag.entity';
export * from './task-tag.entity';
export * from './comment.entity';
export * from './attachment.entity';
export * from './cost-category.entity';
export * from './budget.entity';
export * from './budget-item.entity';
export * from './cost.entity';
export * from './exchange-rate.entity';
export * from './progress-metric.entity';
export * from './audit-log.entity';
export * from './notification.entity';
export * from './ai-conversation.entity';
export * from './ai-message.entity';

/** Todas las entidades del dominio, usadas por DataSource (migrations) y por DatabaseModule (Nest). */
export const ALL_ENTITIES = [
  ProjectEntity,
  UserEntity,
  RoleEntity,
  UserRoleEntity,
  ProjectStatusHistoryEntity,
  ResourceProfileEntity,
  ProjectMemberEntity,
  TaskEntity,
  TaskDependencyEntity,
  TagEntity,
  TaskTagEntity,
  CommentEntity,
  AttachmentEntity,
  CostCategoryEntity,
  BudgetEntity,
  BudgetItemEntity,
  CostEntity,
  ExchangeRateEntity,
  ProgressMetricEntity,
  AuditLogEntity,
  NotificationEntity,
  AiConversationEntity,
  AiMessageEntity,
];
