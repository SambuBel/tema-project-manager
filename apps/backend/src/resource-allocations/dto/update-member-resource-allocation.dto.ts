import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
import type { UpdateMemberResourceAllocationDto as IUpdateMemberResourceAllocationDto } from '@tema/shared-types';
import { HOURS_PATTERN, normalizeHours } from './estimated-cost';

/**
 * Asignación (o cambio) del perfil de recurso y/o de las horas estimadas de un miembro. PATCH real: solo se envía lo que
 * cambia. `expectedRevision` es OBLIGATORIO (RNF-20): 0 si el miembro todavía no tiene asignación; si no, la revisión vigente.
 * Perfil y horas son independientes. `null` quita el dato; omitirlo lo conserva. El usuario que cambia sale del token y el
 * origen lo decide el servidor: `changedBy`, `origin`, `revision` y cualquier otro campo se descartan (whitelist).
 */
export class UpdateMemberResourceAllocationDto implements IUpdateMemberResourceAllocationDto {
  @IsInt({ message: 'expectedRevision debe ser un número entero' })
  @Min(0, { message: 'expectedRevision debe ser 0 (sin asignación previa) o la revisión vigente' })
  expectedRevision!: number;

  /** UUID del perfil del catálogo (debe estar activo si cambia), o null para quitarlo. */
  @IsOptional()
  @IsUUID('all', { message: 'resourceProfileId debe ser un UUID válido' })
  resourceProfileId?: string | null;

  /** String (un número JSON se rechaza: pasaría por float). >= 0 (0 es válido), hasta 6 enteros y 2 decimales; se normaliza a 2 decimales. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeHours(value.trim()) : value))
  @IsString({ message: 'Las horas estimadas deben enviarse como texto (ej. "125.50"), no como número' })
  @Matches(HOURS_PATTERN, { message: 'Las horas estimadas deben ser un monto sin signo, con hasta 6 enteros y 2 decimales' })
  estimatedHours?: string | null;
}
