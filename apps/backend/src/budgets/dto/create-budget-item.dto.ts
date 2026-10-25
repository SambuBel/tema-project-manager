import { Transform } from 'class-transformer';
import { IsString, IsUUID, Matches } from 'class-validator';
import type { CreateBudgetItemDto as ICreateBudgetItemDto } from '@tema/shared-types';
import { AMOUNT_PATTERN, normalizeAmount } from './amount';

/** Una partida del presupuesto: un rubro y su importe, en la MISMA moneda que el presupuesto (no tiene moneda propia). */
export class CreateBudgetItemDto implements ICreateBudgetItemDto {
  @IsUUID('all', { message: 'costCategoryId debe ser un UUID válido' })
  costCategoryId!: string;

  /** Mismas reglas que el total: string (nunca number), >= 0, hasta 12 enteros y 2 decimales; se normaliza a 2 decimales. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeAmount(value.trim()) : value))
  @IsString({ message: 'El importe de la partida debe enviarse como texto (ej. "600000.00"), no como número' })
  @Matches(AMOUNT_PATTERN, { message: 'El importe de la partida debe ser un monto sin signo, con hasta 12 enteros y 2 decimales' })
  amount!: string;
}
