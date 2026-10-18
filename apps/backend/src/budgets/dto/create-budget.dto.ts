import { Transform } from 'class-transformer';
import { IsDateString, IsString, Matches } from 'class-validator';
import type { CreateBudgetDto as ICreateBudgetDto } from '@tema/shared-types';
import { AMOUNT_PATTERN, normalizeAmount } from './amount';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Alta del presupuesto inicial. Solo estos tres campos: `version`, `isCurrent` y `createdBy` los decide el servidor
 * (el ValidationPipe con whitelist descarta cualquier otro campo que mande el cliente).
 */
export class CreateBudgetDto implements ICreateBudgetDto {
  /** String (un número JSON se rechaza: pasaría por float). Hasta 12 enteros y 2 decimales, >= 0; se normaliza a 2 decimales. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeAmount(value.trim()) : value))
  @IsString({ message: 'El importe debe enviarse como texto (ej. "1500000.50"), no como número' })
  @Matches(AMOUNT_PATTERN, { message: 'El importe debe ser un monto sin signo, con hasta 12 enteros y 2 decimales' })
  totalAmount!: string;

  /** trim + mayúsculas, luego exactamente 3 letras. Sin catálogo de monedas todavía (pendiente de TEMA). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString({ message: 'La moneda debe ser texto' })
  @Matches(/^[A-Z]{3}$/, { message: 'La moneda debe ser un código de 3 letras (ej. ARS, USD)' })
  currency!: string;

  /** Exactamente YYYY-MM-DD y una fecha de calendario real (2026-02-31 no). Las fechas futuras se aceptan (sin regla definida). */
  @Transform(trimmed)
  @IsString({ message: 'La fecha de aprobación debe ser texto con formato AAAA-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha de aprobación debe tener formato AAAA-MM-DD' })
  @IsDateString({ strict: true }, { message: 'La fecha de aprobación no es una fecha válida' })
  approvalDate!: string;
}
