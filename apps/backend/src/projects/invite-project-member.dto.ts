import { IsEmail, IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ProjectMemberRole } from '../database/enums';
import { InviteProjectMemberDto as IInviteProjectMemberDto } from '@tema/shared-types';

export class InviteProjectMemberDto implements IInviteProjectMemberDto {
  @IsEmail({}, { message: 'El correo debe ser válido' })
  @IsNotEmpty({ message: 'El correo es obligatorio' })
  email!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío ni contener solo espacios' })
  @MaxLength(255, { message: 'El nombre no puede exceder los 255 caracteres' })
  name!: string;

  @IsEnum(ProjectMemberRole, { message: 'Rol inválido' })
  @IsNotEmpty({ message: 'El rol es obligatorio' })
  projectRole!: ProjectMemberRole;
}
