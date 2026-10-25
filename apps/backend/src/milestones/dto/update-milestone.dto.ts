import { IsDateString, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateMilestoneDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(200, { message: 'El nombre no puede superar los 200 caracteres' })
  name?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha objetivo debe tener el formato YYYY-MM-DD' })
  @IsDateString({}, { message: 'La fecha objetivo debe ser una fecha válida' })
  dueDate?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  description?: string;
}
