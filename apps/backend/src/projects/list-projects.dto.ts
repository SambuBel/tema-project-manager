import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ProjectStatus } from '../database/enums';
import type { ListProjectsQuery } from '@tema/shared-types';

export class ListProjectsDto implements ListProjectsQuery {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
