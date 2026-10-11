import { IsEmail, IsEnum } from 'class-validator';
import type { InviteProjectMemberDto } from '@tema/shared-types';
import { ProjectMemberRole } from '../database/enums';

export class InviteProjectMemberDtoImpl implements InviteProjectMemberDto {
  @IsEmail({}, { message: 'El email no es válido' })
  email!: string;

  /** Solo COLLABORATOR u OBSERVER: PROJECT_LEADER nunca es un projectRole válido en una invitación. */
  @IsEnum(ProjectMemberRole, { message: 'El rol del proyecto debe ser COLLABORATOR u OBSERVER' })
  projectRole!: ProjectMemberRole;
}
