import { IsEnum } from 'class-validator';
import { ProjectStatus } from '../database/enums';
import type { UpdateProjectStatusDto as IUpdateProjectStatusDto } from '@tema/shared-types';

export class UpdateProjectStatusDto implements IUpdateProjectStatusDto {
  @IsEnum(ProjectStatus)
  status!: ProjectStatus;

  // FIXME: DEPENDENCY BLOCKER - Autenticación no disponible
  // Cuando Auth esté implementado, este ID debería provenir del usuario en sesión
  // y no ser opcional. O bien eliminarse del DTO si se toma del request directamente.
  changedByUserId?: string;
}
