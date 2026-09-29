import { IsUUID } from 'class-validator';
import type { ChangeProjectLeaderDto as IChangeProjectLeaderDto } from '@tema/shared-types';

export class ChangeProjectLeaderDto implements IChangeProjectLeaderDto {
  @IsUUID()
  newLeaderId!: string;
}
