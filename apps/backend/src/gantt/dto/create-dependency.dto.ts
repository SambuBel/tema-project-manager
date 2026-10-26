import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { DependencyType } from '../../database/enums';

export class CreateDependencyDto {
  @IsUUID()
  predecessorTaskId!: string;

  @IsUUID()
  successorTaskId!: string;

  @IsOptional()
  @IsEnum(DependencyType)
  dependencyType?: DependencyType = DependencyType.FINISH_START;
}