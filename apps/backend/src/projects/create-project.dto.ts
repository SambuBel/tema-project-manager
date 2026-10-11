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

  /**
   * Líder del proyecto. Opcional si quien crea tiene PROJECT_LEADER (queda él mismo); obligatorio
   * si es ADMIN/PM sin ese rol. Siempre se valida en el backend (existe, activo, PROJECT_LEADER).
   */
  @IsOptional()
  @IsUUID('all', { message: 'leaderId debe ser un id de usuario válido' })
  leaderId?: string;
}
