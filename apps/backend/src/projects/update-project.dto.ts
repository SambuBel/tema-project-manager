import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsDateString, IsIn, IsNotEmpty, MaxLength } from 'class-validator';
import type { UpdateProjectDto } from '@tema/shared-types';
import { ALLOWED_CURRENCIES } from '../economy/project-currency';

export class UpdateProjectDtoImpl implements UpdateProjectDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(200, { message: 'El nombre no puede superar los 200 caracteres' })
  name?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El objetivo debe ser texto' })
  @IsNotEmpty({ message: 'El objetivo no puede estar vacío' })
  description?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'La fecha de inicio debe ser una fecha válida (formato AAAA-MM-DD)' })
  startDate?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'La fecha de entrega debe ser una fecha válida (formato AAAA-MM-DD)' })
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
