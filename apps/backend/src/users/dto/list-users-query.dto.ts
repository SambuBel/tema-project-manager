import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import type { ListUsersQuery as IListUsersQuery } from '@tema/shared-types';
import { RoleName } from '../../database/enums';

export class ListUsersQueryDto implements IListUsersQuery {
  /** Opt-in: sin esto el listado sigue excluyendo desactivados (así lo esperan ProjectForm, ChangeLeaderModal, etc.). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;
}
