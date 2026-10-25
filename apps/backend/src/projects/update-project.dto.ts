import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsDateString, Matches } from 'class-validator';
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

  /**
   * Cambio de la moneda única del proyecto: solo mientras NO tenga datos económicos (presupuesto, costos o asignaciones); si no,
   * 409 PROJECT_CURRENCY_IN_USE. trim + mayúsculas, exactamente 3 letras.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString({ message: 'La moneda del proyecto debe ser texto' })
  @Matches(/^[A-Z]{3}$/, { message: 'La moneda del proyecto debe ser un código de 3 letras (ej. ARS, USD)' })
  economicCurrency?: string;
}
