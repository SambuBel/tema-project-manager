import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ProjectMemberRole } from '../database/enums';
import { InviteProjectMemberDto as IInviteProjectMemberDto } from '@tema/shared-types';

export class InviteProjectMemberDto implements IInviteProjectMemberDto {
  @IsEmail({}, { message: 'El correo debe ser válido' })
  @IsNotEmpty({ message: 'El correo es obligatorio' })
  email!: string;

  @IsString({ message: 'El nombre debe ser texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  name!: string;

  @IsEnum(ProjectMemberRole, { message: 'Rol inválido' })
  @IsNotEmpty({ message: 'El rol es obligatorio' })
  projectRole!: ProjectMemberRole;
}
