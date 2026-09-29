import { IsString, IsOptional, IsDateString } from 'class-validator';
import type { UpdateProjectDto } from '@tema/shared-types';

export class UpdateProjectDtoImpl implements UpdateProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  estimatedEndDate?: string;
}

