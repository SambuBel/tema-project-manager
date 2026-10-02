import { IsBoolean } from 'class-validator';
import type { UpdateUserStatusDto as IUpdateUserStatusDto } from '@tema/shared-types';

export class UpdateUserStatusDto implements IUpdateUserStatusDto {
  @IsBoolean()
  active!: boolean;
}
