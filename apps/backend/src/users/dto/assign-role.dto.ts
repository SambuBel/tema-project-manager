import { IsEnum } from 'class-validator';
import type { AssignRoleDto as IAssignRoleDto } from '@tema/shared-types';
import { RoleName } from '../../database/enums';

export class AssignRoleDto implements IAssignRoleDto {
  @IsEnum(RoleName, { message: `role debe ser uno de: ${Object.values(RoleName).join(', ')}` })
  role!: RoleName;
}
