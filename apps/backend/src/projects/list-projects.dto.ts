import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ProjectStatus } from '../database/enums';
import type { ListProjectsQuery } from '@tema/shared-types';

export class ListProjectsDto implements ListProjectsQuery {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  archived?: boolean;
}
