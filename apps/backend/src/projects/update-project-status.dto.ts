import { IsEnum } from 'class-validator';
import { ProjectStatus } from '../database/enums';
import type { UpdateProjectStatusDto as IUpdateProjectStatusDto } from '@tema/shared-types';

export class UpdateProjectStatusDto implements IUpdateProjectStatusDto {
  @IsEnum(ProjectStatus)
  status!: ProjectStatus;
}
