import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { LoginDto as ILoginDto } from '@tema/shared-types';
import { normalizeEmail } from '../password';

/**
 * Sin @IsEmail a propósito: un formato inválido tiene que terminar igual que un email inexistente
 * (401 con el mensaje genérico), no en un 400 que enseñe qué se está validando. El tope de largo de la
 * contraseña evita que alguien fuerce a argon2 a hashear megabytes de texto.
 */
export class LoginDto implements ILoginDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeEmail(value) : value))
  @IsString({ message: 'El email es obligatorio' })
  @IsNotEmpty({ message: 'El email es obligatorio' })
  @MaxLength(255)
  email!: string;

  @IsString({ message: 'La contraseña es obligatoria' })
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MaxLength(256)
  password!: string;
}
