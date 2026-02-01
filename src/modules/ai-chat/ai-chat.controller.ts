import { Controller, Post, Body, Get, Param, UseGuards } from '@nestjs/common';
import { AIChatService } from './ai-chat.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessPayload } from '../auth/types/jwt-payload';

@Controller('ai')
@UseGuards(JwtAccessGuard)
export class AIChatController {
  constructor(private readonly aiChatService: AIChatService) {}

  /**
   * Send message to AI
   * POST /api/ai/chat
   */
  @Post('chat')
  async sendMessage(@CurrentUser() user: JwtAccessPayload, @Body() dto: ChatMessageDto) {
    return this.aiChatService.sendMessage(user.sub, dto.message, dto.threadId, dto.preferredLanguage);
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
