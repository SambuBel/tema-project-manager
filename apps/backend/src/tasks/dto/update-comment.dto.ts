import { IsArray, IsNotEmpty, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CommentMentionDto } from './comment-mention.dto';

export class UpdateCommentDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/[^\s]/, { message: 'El comentario no puede estar compuesto solo por espacios' })
  content!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommentMentionDto)
  mentions?: CommentMentionDto[];
}
