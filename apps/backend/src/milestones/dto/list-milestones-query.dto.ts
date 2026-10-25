import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListMilestonesQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true || value === '1' || value === 1)
  @IsBoolean()
  upcoming?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
