import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import type { CreateProjectDto as ICreateProjectDto } from '@tema/shared-types';
import { IsNotBefore } from '../tasks/dto/is-not-before.validator';

export class CreateProjectDto implements ICreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  @IsNotBefore('startDate', { message: 'La fecha de entrega no puede ser anterior a la de inicio' })
  estimatedEndDate?: string;

  /**
   * Líder del proyecto. Opcional si quien crea tiene PROJECT_LEADER (queda él mismo); obligatorio
   * si es ADMIN/PM sin ese rol. Siempre se valida en el backend (existe, activo, PROJECT_LEADER).
   */
  @IsOptional()
  @IsUUID('all', { message: 'leaderId debe ser un id de usuario válido' })
  leaderId?: string;

  /**
   * Moneda ÚNICA del proyecto (presupuesto, costos y asignaciones). trim + mayúsculas, exactamente 3 letras (la UI ofrece ARS y
   * USD). Omitida = ARS. Es información económica: solo la ven ADMIN, PM y el líder real.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString({ message: 'La moneda del proyecto debe ser texto' })
  @Matches(/^[A-Z]{3}$/, { message: 'La moneda del proyecto debe ser un código de 3 letras (ej. ARS, USD)' })
  economicCurrency?: string;
}
