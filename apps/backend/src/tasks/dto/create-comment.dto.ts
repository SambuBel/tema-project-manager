import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/[^\s]/, { message: 'El comentario no puede estar compuesto solo por espacios' })
  content!: string;
}
