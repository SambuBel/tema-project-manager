import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsOptional, IsIn } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';

export class UpdateTaskDto extends PartialType(
  OmitType(CreateTaskDto, ['projectId'] as const),
) {
  @IsOptional()
  @IsIn(['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'BLOCKED'])
  status?: string;
}