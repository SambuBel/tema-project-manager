import { IsString, IsUUID, Matches } from 'class-validator';

export class CascadePreviewDto {
  @IsUUID()
  taskId: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'newStartDate debe tener formato YYYY-MM-DD' })
  newStartDate: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'newDueDate debe tener formato YYYY-MM-DD' })
  newDueDate: string;
}