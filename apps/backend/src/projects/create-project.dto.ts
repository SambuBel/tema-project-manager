import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { CreateProjectDto as ICreateProjectDto } from '@tema/shared-types';

export class CreateProjectDto implements ICreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

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
