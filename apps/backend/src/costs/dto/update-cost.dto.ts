import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import type { UpdateCostDto as IUpdateCostDto } from '@tema/shared-types';
import { AMOUNT_PATTERN, normalizeAmount } from '../../budgets/dto/amount';
import { MAX_COST_DESCRIPTION_LENGTH } from './create-cost.dto';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Un campo editable es opcional (omitido = no cambia) pero, si viene, NO puede ser null. */
const whenPresent = (_object: unknown, value: unknown) => value !== undefined;

/**
 * Edición parcial (PATCH) de un costo: solo se envía lo que cambia. `expectedRevision` es OBLIGATORIO: sin él no habría
 * forma de detectar que otro usuario editó el costo entre medio (RNF-20). Mismas reglas que el alta para cada campo.
 * `id`, `projectId`, `createdBy`, `createdAt`, `updatedAt`, `deletedAt` y `revision` no se aceptan: el whitelist los descarta.
 */
export class UpdateCostDto implements IUpdateCostDto {
  /** Revisión que el usuario tenía en pantalla (la que devolvió el GET). */
  @IsInt({ message: 'expectedRevision debe ser un número entero' })
  @Min(1, { message: 'expectedRevision debe ser 1 o mayor' })
  expectedRevision!: number;

  @ValidateIf(whenPresent)
  @Transform(trimmed)
  @IsString({ message: 'La fecha del costo debe ser texto con formato AAAA-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha del costo debe tener formato AAAA-MM-DD' })
  @IsDateString({ strict: true }, { message: 'La fecha del costo no es una fecha válida' })
  costDate?: string;

  @ValidateIf(whenPresent)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeAmount(value.trim()) : value))
  @IsString({ message: 'El importe debe enviarse como texto (ej. "150000.50"), no como número' })
  @Matches(AMOUNT_PATTERN, { message: 'El importe debe ser un monto sin signo, con hasta 12 enteros y 2 decimales' })
  amount?: string;

  @ValidateIf(whenPresent)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString({ message: 'La moneda debe ser texto' })
  @Matches(/^[A-Z]{3}$/, { message: 'La moneda debe ser un código de 3 letras (ej. ARS, USD)' })
  currency?: string;

  @ValidateIf(whenPresent)
  @IsUUID('all', { message: 'costCategoryId debe ser un UUID válido' })
  costCategoryId?: string;

  @ValidateIf(whenPresent)
  @Transform(trimmed)
  @IsString({ message: 'La descripción es obligatoria' })
  @IsNotEmpty({ message: 'La descripción es obligatoria' })
  @MaxLength(MAX_COST_DESCRIPTION_LENGTH, { message: `La descripción puede tener como máximo ${MAX_COST_DESCRIPTION_LENGTH} caracteres` })
  description?: string;

  /** UUID = asignar esa tarea; null = quitar la asociación; omitido = conservar la actual. */
  @IsOptional()
  @IsUUID('all', { message: 'taskId debe ser un UUID válido' })
  taskId?: string | null;

  /** RN-21: confirma explícitamente una fecha anterior al inicio del proyecto. Solo se mira si la edición cambia `costDate`. */
  @IsOptional()
  @IsBoolean({ message: 'confirmBeforeProjectStart debe ser true o false' })
  confirmBeforeProjectStart?: boolean;
}
