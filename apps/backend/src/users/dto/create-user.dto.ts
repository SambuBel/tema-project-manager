import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { CreateUserDto as ICreateUserDto } from '@tema/shared-types';
import { RoleName } from '../../database/enums';
import { normalizeEmail } from '../../auth/password';

/** Alta de usuario por un ADMIN. NO existe passwordHash acá: el backend hashea `password` y nunca la devuelve. */
export class CreateUserDto implements ICreateUserDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeEmail(value) : value))
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(255)
  email!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(200, { message: 'El nombre puede tener como máximo 200 caracteres' })
  name!: string;

  @IsString({ message: 'La contraseña debe ser texto' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(128, { message: 'La contraseña puede tener como máximo 128 caracteres' })
  password!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(5)
  @IsEnum(RoleName, { each: true, message: `Cada rol debe ser uno de: ${Object.values(RoleName).join(', ')}` })
  roles?: RoleName[];
}
