import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { AiService, MensajeHistorial } from './ai.service';

export class ConsultaChatDto {
  @IsString()
  mensaje!: string;

  @IsOptional()
  @IsArray()
  historial?: MensajeHistorial[];
}

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chatear(
    @Body() datos: ConsultaChatDto,
    @CurrentUser() usuario: RequestUser,
  ) {
    return this.aiService.procesarMensaje(
      datos.mensaje,
      datos.historial ?? [],
      usuario,
    );
  }
}
