import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * `?includeInactive=true` agrega los perfiles inactivos (administración). Solo se aceptan los textos "true" y "false";
 * cualquier otro valor es un 400 (no se interpreta "1", "yes", etc.).
 */
export class ListResourceProfilesQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'includeInactive debe ser true o false' })
  includeInactive?: boolean;
}
