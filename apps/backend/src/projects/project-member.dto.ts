import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { AddProjectMemberDto, UpdateProjectMemberRoleDto } from '@tema/shared-types';

export class AddProjectMemberDtoImpl implements AddProjectMemberDto {
  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  projectRole!: string;
}

export class UpdateProjectMemberRoleDtoImpl implements UpdateProjectMemberRoleDto {
  @IsString()
  @IsNotEmpty()
  projectRole!: string;
}
