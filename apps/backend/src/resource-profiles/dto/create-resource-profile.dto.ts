import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import type { CreateResourceProfileDto as ICreateResourceProfileDto } from '@tema/shared-types';
import { HOURLY_COST_PATTERN, normalizeHourlyCost } from './hourly-cost';

export const MAX_PROFILE_NAME_LENGTH = 150;

export const trimmedText = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const normalizedHourlyCost = ({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeHourlyCost(value.trim()) : value);
export const normalizedCurrency = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

/**
 * Alta de un perfil de recurso. Siempre nace activo y con revision 1: `active`, `revision`, `id`, `createdAt` y `updatedAt`
 * no se aceptan (el ValidationPipe con whitelist los descarta).
 */
export class CreateResourceProfileDto implements ICreateResourceProfileDto {
  /** Con trim, no vacío, hasta 150 caracteres. Se conserva tal cual (sin cambiar mayúsculas): la unicidad ignora mayúsculas, el texto no. */
  @Transform(trimmedText)
  @IsString({ message: 'El nombre es obligatorio' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(MAX_PROFILE_NAME_LENGTH, { message: `El nombre puede tener como máximo ${MAX_PROFILE_NAME_LENGTH} caracteres` })
  name!: string;

  /** String (un número JSON se rechaza: pasaría por float). >= 0 (0 es válido), hasta 10 enteros y 2 decimales; se normaliza a 2 decimales. */
  @Transform(normalizedHourlyCost)
  @IsString({ message: 'El costo por hora debe enviarse como texto (ej. "50.00"), no como número' })
  @Matches(HOURLY_COST_PATTERN, { message: 'El costo por hora debe ser un monto sin signo, con hasta 10 enteros y 2 decimales' })
  hourlyCost!: string;

  /** trim + mayúsculas, luego exactamente 3 letras. Sin catálogo ISO ni conversiones (FX-01). */
  @Transform(normalizedCurrency)
  @IsString({ message: 'La moneda debe ser texto' })
  @Matches(/^[A-Z]{3}$/, { message: 'La moneda debe ser un código de 3 letras (ej. ARS, USD)' })
  currency!: string;
}
