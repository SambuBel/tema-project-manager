import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { CreateProjectDto as ICreateProjectDto } from '@tema/shared-types';
import { IsNotBefore } from '../tasks/dto/is-not-before.validator';
import { ALLOWED_CURRENCIES } from '../economy/project-currency';

export class CreateProjectDto implements ICreateProjectDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El nombre es obligatorio' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(200, { message: 'El nombre no puede superar los 200 caracteres' })
  name!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El objetivo es obligatorio' })
  @IsNotEmpty({ message: 'El objetivo no puede estar vacío' })
  description?: string;

  @IsNotEmpty({ message: 'La fecha de inicio es obligatoria' })
  @IsDateString({ strict: true }, { message: 'La fecha de inicio debe ser una fecha válida (formato AAAA-MM-DD)' })
  startDate?: string;

  @IsNotEmpty({ message: 'La fecha de entrega es obligatoria' })
  @IsDateString({ strict: true }, { message: 'La fecha de entrega debe ser una fecha válida (formato AAAA-MM-DD)' })
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
  @IsIn(ALLOWED_CURRENCIES, { message: 'La moneda del proyecto debe ser ARS o USD' })
  economicCurrency?: string;

  /**
   * Clave de idempotencia opcional generada por el cliente para evitar crear proyectos duplicados
   * si el mismo envío llega más de una vez (doble clic o reintento de red).
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'idempotencyKey debe ser texto' })
  @MinLength(1, { message: 'idempotencyKey no puede estar vacío' })
  @MaxLength(100, { message: 'idempotencyKey no puede superar los 100 caracteres' })
  idempotencyKey?: string;
}
