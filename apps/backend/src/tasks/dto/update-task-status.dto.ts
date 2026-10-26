import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { TaskStatus } from '../../database/enums';

export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus, {
    message: `Estado inválido. Valores permitidos: ${Object.values(TaskStatus).join(', ')}`,
  })
  status!: TaskStatus;

  /**
   * Si es true y la tarea principal tiene subtareas pendientes al pasar a COMPLETED,
   * valida permisos y transiciones en cada subtarea, completa primero las subtareas
   * pendientes y luego la tarea principal dentro de una misma transacción atómica.
   */
  @IsOptional()
  @IsBoolean()
  completeSubtasks?: boolean;
}
