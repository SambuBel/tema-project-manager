import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { AiService } from './ai.service';
import { ChatMessageDto } from './dto/chat-message.dto';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chat(@Body() dto: ChatMessageDto, @CurrentUser() user: RequestUser) {
    const reply = await this.aiService.answer(dto, user);
    return { reply };
  }

  /** Para que el panel muestre si esta en modo demo (reglas) o con Gemini. */
  @Get('status')
  status() {
    return { mode: this.aiService.mode };
  }
}
