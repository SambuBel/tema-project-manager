import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsDateString, IsIn } from 'class-validator';
import type { UpdateProjectDto } from '@tema/shared-types';
import { ALLOWED_CURRENCIES } from '../economy/project-currency';

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
  @IsIn(ALLOWED_CURRENCIES, { message: 'La moneda del proyecto debe ser ARS o USD' })
  economicCurrency?: string;
}
