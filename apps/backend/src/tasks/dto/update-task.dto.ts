import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { TaskPriority, TaskStatus } from '../../database/enums';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;

  /** Campo de PLANIFICACION: cambiarlo exige canManageTaskPlanning (ver TasksService.update). null = limpiar. */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'La fecha de inicio no es válida (formato AAAA-MM-DD)' })
  startDate?: string | null;

  /** Campo de PLANIFICACION. El orden contra startDate se valida en el service (puede venir solo uno de los dos). */
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'La fecha de vencimiento no es válida (formato AAAA-MM-DD)' })
  dueDate?: string | null;

  /**
   * Si es true y la tarea principal pasa a COMPLETED teniendo subtareas pendientes,
   * completa primero las subtareas pendientes y luego la tarea principal en una transacción atómica.
   */
  @IsOptional()
  @IsBoolean()
  completeSubtasks?: boolean;
}
