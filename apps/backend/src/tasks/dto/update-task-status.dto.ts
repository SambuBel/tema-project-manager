import { IsEnum } from 'class-validator';
import { TaskStatus } from '../../database/enums';

export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus, {
    message: `Estado inválido. Valores permitidos: ${Object.values(TaskStatus).join(', ')}`,
  })
  status!: TaskStatus;
}