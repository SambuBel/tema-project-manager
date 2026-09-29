import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { AddProjectMemberDto, UpdateProjectMemberRoleDto } from '@tema/shared-types';
import { ProjectMemberRole } from '../database/enums';

export class AddProjectMemberDtoImpl implements AddProjectMemberDto {
  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  /** Solo COLLABORATOR u OBSERVER: PROJECT_LEADER nunca es un projectRole válido acá. */
  @IsEnum(ProjectMemberRole)
  projectRole!: ProjectMemberRole;
}

export class UpdateProjectMemberRoleDtoImpl implements UpdateProjectMemberRoleDto {
  @IsEnum(ProjectMemberRole)
  projectRole!: ProjectMemberRole;
}
