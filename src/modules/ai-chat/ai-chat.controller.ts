import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  InternalServerErrorException,
  Logger,
  HttpException,
} from '@nestjs/common';
import { AIChatService } from './ai-chat.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { TranscribeAudioDto } from './dto/transcribe-audio.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('ai')
@UseGuards(JwtAccessGuard)
export class AIChatController {
  private readonly logger = new Logger(AIChatController.name);

  constructor(private readonly aiChatService: AIChatService) {}

  /**
   * Send message to AI
   * POST /api/ai/chat
   */
  @Post('chat')
  async sendMessage(@CurrentUser() user: JwtAccessPayload, @Body() dto: ChatMessageDto) {
    try {
      return await this.aiChatService.sendMessage(user.sub, dto);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`[AI Chat] sendMessage failed: ${msg}`, stack);
      throw new InternalServerErrorException(
        'Не удалось обработать сообщение. Попробуйте позже.',
      );
    }
  }

  /**
   * Голос → текст (Whisper). Ответ используйте в обычном POST /api/ai/chat.
   */
  @Post('transcribe')
  async transcribe(@CurrentUser() user: JwtAccessPayload, @Body() dto: TranscribeAudioDto) {
    try {
      return await this.aiChatService.transcribeVoice(user.sub, dto.audioBase64, dto.mimeType);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[AI transcribe] failed: ${msg}`);
      throw new InternalServerErrorException('Не удалось распознать речь. Попробуйте позже.');
    }
  }

  /**
   * Get thread history
   * GET /api/ai/threads/:id
   */
  @Get('threads/:id')
  async getThread(@CurrentUser() user: JwtAccessPayload, @Param('id') threadId: string) {
    return this.aiChatService.getThreadHistory(threadId, user.sub);
  }

  /**
   * List user threads
   * GET /api/ai/threads
   */
  @Get('threads')
  async listThreads(@CurrentUser() user: JwtAccessPayload) {
    return this.aiChatService.listThreads(user.sub);
  }
}
