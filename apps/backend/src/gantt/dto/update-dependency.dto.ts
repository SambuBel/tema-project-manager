import { IsEnum } from 'class-validator';
import { DependencyType } from '../../database/enums';

export class UpdateDependencyDto {
  @IsEnum(DependencyType)
  dependencyType!: DependencyType;
}