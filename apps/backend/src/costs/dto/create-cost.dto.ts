import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { CreateCostDto as ICreateCostDto } from '@tema/shared-types';
import { AMOUNT_PATTERN, normalizeAmount } from '../../budgets/dto/amount';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Tope técnico de la descripción. NO es un requisito funcional de TEMA: la columna es `text` sin límite; se acota para
 * evitar abusos.
 */
export const MAX_COST_DESCRIPTION_LENGTH = 500;

/**
 * Alta de un costo incurrido. `projectId` sale de la URL y `createdBy` del usuario autenticado: el ValidationPipe con
 * whitelist descarta cualquier otro campo que mande el cliente (createdBy, projectId, updatedAt, deletedAt...).
 */
export class CreateCostDto implements ICreateCostDto {
  /** Exactamente YYYY-MM-DD y una fecha de calendario real. Se acepta una fecha futura (TEMA no la prohíbe). */
  @Transform(trimmed)
  @IsString({ message: 'La fecha del costo debe ser texto con formato AAAA-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha del costo debe tener formato AAAA-MM-DD' })
  @IsDateString({ strict: true }, { message: 'La fecha del costo no es una fecha válida' })
  costDate!: string;

  /** String (un número JSON se rechaza: pasaría por float). Hasta 12 enteros y 2 decimales, >= 0; se normaliza a 2 decimales. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeAmount(value.trim()) : value))
  @IsString({ message: 'El importe debe enviarse como texto (ej. "150000.50"), no como número' })
  @Matches(AMOUNT_PATTERN, { message: 'El importe debe ser un monto sin signo, con hasta 12 enteros y 2 decimales' })
  amount!: string;

  /** trim + mayúsculas, luego exactamente 3 letras. Sin catálogo ISO todavía. Puede diferir de la moneda del presupuesto. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString({ message: 'La moneda debe ser texto' })
  @Matches(/^[A-Z]{3}$/, { message: 'La moneda debe ser un código de 3 letras (ej. ARS, USD)' })
  currency!: string;

  @IsUUID('all', { message: 'costCategoryId debe ser un UUID válido' })
  costCategoryId!: string;

  /** Obligatoria (RF-CT-03): con trim, no vacía y de hasta MAX_COST_DESCRIPTION_LENGTH caracteres. */
  @Transform(trimmed)
  @IsString({ message: 'La descripción es obligatoria' })
  @IsNotEmpty({ message: 'La descripción es obligatoria' })
  @MaxLength(MAX_COST_DESCRIPTION_LENGTH, { message: `La descripción puede tener como máximo ${MAX_COST_DESCRIPTION_LENGTH} caracteres` })
  description!: string;

  /** Opcional. Debe pertenecer al mismo proyecto (se valida en el servicio). */
  @IsOptional()
  @IsUUID('all', { message: 'taskId debe ser un UUID válido' })
  taskId?: string;

  /** RN-21: confirma explícitamente un costo con fecha anterior al inicio del proyecto. Debe ser un booleano real. */
  @IsOptional()
  @IsBoolean({ message: 'confirmBeforeProjectStart debe ser true o false' })
  confirmBeforeProjectStart?: boolean;
}
