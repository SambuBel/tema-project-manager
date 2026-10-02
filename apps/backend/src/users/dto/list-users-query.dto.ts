import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { ListUsersQuery as IListUsersQuery } from '@tema/shared-types';
import { RoleName } from '../../database/enums';

export class ListUsersQueryDto implements IListUsersQuery {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;
}
