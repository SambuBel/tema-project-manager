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

  // Un proyecto siempre tiene lider (regla de negocio: no puede quedar sin lider).
  @IsUUID()
  leaderId!: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  estimatedEndDate?: string;
}
