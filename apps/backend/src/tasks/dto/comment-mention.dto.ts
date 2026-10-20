import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from 'class-validator';

export class CommentMentionDto {
  @IsUUID('4', { message: 'userId debe ser un UUID válido' })
  userId!: string;

  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  name!: string;

  @IsInt({ message: 'startIndex debe ser un entero' })
  @Min(0, { message: 'startIndex no puede ser negativo' })
  startIndex!: number;

  @IsInt({ message: 'endIndex debe ser un entero' })
  @Min(0, { message: 'endIndex no puede ser negativo' })
  endIndex!: number;
}
