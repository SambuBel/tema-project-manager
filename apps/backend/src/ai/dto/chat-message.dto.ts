import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export const MAX_HISTORY_TURNS = 20;

export class ChatTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  text!: string;
}

export class ChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  /** UUID o slug: las URLs de proyecto ahora usan slug (ver ProjectsService.findOne). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  projectId?: string;

  /** Mensajes anteriores de la conversacion (el backend no guarda estado). Solo los usa Gemini. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HISTORY_TURNS)
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  history?: ChatTurnDto[];
}
