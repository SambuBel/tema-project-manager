import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { CreateTaskDto as ICreateTaskDto } from '@tema/shared-types';
import { TaskPriority, TaskStatus } from '../../database/enums';
import { IsNotBefore } from './is-not-before.validator';

export class CreateTaskDto implements ICreateTaskDto {
  @IsUUID('all', { message: 'projectId debe ser un id de proyecto válido' })
  projectId!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El título debe ser texto' })
  @IsNotEmpty({ message: 'El título es obligatorio' })
  @MaxLength(200, { message: 'El título puede tener como máximo 200 caracteres' })
  title!: string;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser texto' })
  description?: string;

  @IsOptional()
  @IsEnum(TaskStatus, { message: 'El estado no es válido' })
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority, { message: 'La prioridad no es válida' })
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID('all', { message: 'El responsable debe ser un id de usuario válido' })
  assignedToId?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'La fecha de inicio no es válida (formato AAAA-MM-DD)' })
  startDate?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'La fecha de vencimiento no es válida (formato AAAA-MM-DD)' })
  @IsNotBefore('startDate', { message: 'La fecha de vencimiento no puede ser anterior a la de inicio' })
  dueDate?: string;
}
