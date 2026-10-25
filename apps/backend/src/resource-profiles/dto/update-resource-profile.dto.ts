import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import type { UpdateResourceProfileDto as IUpdateResourceProfileDto } from '@tema/shared-types';
import { HOURLY_COST_PATTERN } from './hourly-cost';
import { MAX_PROFILE_NAME_LENGTH, normalizedCurrency, normalizedHourlyCost, trimmedText } from './create-resource-profile.dto';

/** Un campo editable es opcional (omitido = no cambia) pero, si viene, NO puede ser null. */
const whenPresent = (_object: unknown, value: unknown) => value !== undefined;

/**
 * Edición parcial (PATCH) de un perfil: solo se envía lo que cambia. `expectedRevision` es OBLIGATORIO (RNF-20): sin él no hay
 * forma de detectar que otro administrador editó el perfil entre medio. Mismas reglas que el alta para cada campo.
 * `id`, `revision`, `createdAt` y `updatedAt` no se aceptan (el whitelist los descarta).
 */
export class UpdateResourceProfileDto implements IUpdateResourceProfileDto {
  @IsInt({ message: 'expectedRevision debe ser un número entero' })
  @Min(1, { message: 'expectedRevision debe ser 1 o mayor' })
  expectedRevision!: number;

  @ValidateIf(whenPresent)
  @Transform(trimmedText)
  @IsString({ message: 'El nombre es obligatorio' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(MAX_PROFILE_NAME_LENGTH, { message: `El nombre puede tener como máximo ${MAX_PROFILE_NAME_LENGTH} caracteres` })
  name?: string;

  @ValidateIf(whenPresent)
  @Transform(normalizedHourlyCost)
  @IsString({ message: 'El costo por hora debe enviarse como texto (ej. "50.00"), no como número' })
  @Matches(HOURLY_COST_PATTERN, { message: 'El costo por hora debe ser un monto sin signo, con hasta 10 enteros y 2 decimales' })
  hourlyCost?: string;

  @ValidateIf(whenPresent)
  @Transform(normalizedCurrency)
  @IsString({ message: 'La moneda debe ser texto' })
  @Matches(/^[A-Z]{3}$/, { message: 'La moneda debe ser un código de 3 letras (ej. ARS, USD)' })
  currency?: string;

  /** true = reactivar, false = desactivar. Un booleano real (no "true"). */
  @ValidateIf(whenPresent)
  @IsBoolean({ message: 'active debe ser true o false' })
  active?: boolean;
}
