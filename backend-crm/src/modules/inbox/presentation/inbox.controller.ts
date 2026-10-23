import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  type MessageEvent,
  Param,
  Post,
  Put,
  Query,
  Res,
  Sse,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { ErrorResponseDto } from '../../../shared/http/error-response.dto';
import { SWAGGER_BEARER } from '../../../shared/http/swagger';
import type { AuthContext } from '../../auth/application/auth.service';
import { CurrentUser } from '../../auth/presentation/auth.decorators';
import type { WorkspaceAccess } from '../../authorization/application/authorization.service';
import {
  CurrentWorkspace,
  RequirePermissions,
} from '../../authorization/presentation/workspace-access.decorators';
import { WorkspaceAccessGuard } from '../../authorization/presentation/workspace-access.guard';
import { SetContactTagsDto } from '../../contacts/presentation/contacts.dto';
import { ContactBlockService } from '../application/contact-block.service';
import { InboxMediaService } from '../application/inbox-media.service';
import { InboxService, type InboxActor } from '../application/inbox.service';
import { MAX_MEDIA_BYTES, mediaHeaders } from '../application/media';
import { InboxStreamService } from '../application/inbox-stream.service';
import {
  AssignConversationDto,
  BlockResultDto,
  InboxOptionsDto,
  AutoAssignmentOptionsDto,
  ConversationDto,
  ConversationPageDto,
  InboxCountsDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  MessageDto,
  MessagePageDto,
  PauseBotDto,
  SendContactsDto,
  SendMediaDto,
  SendTextDto,
} from './inbox.dto';

const actor = (auth: AuthContext, access: WorkspaceAccess): InboxActor => ({
  userId: auth.userId,
  access,
});

@ApiTags('inbox')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Missing permission.',
  type: ErrorResponseDto,
})
@ApiNotFoundResponse({
  description:
    'Not a member of the workspace, or CONVERSATION_NOT_FOUND (also for conversations you may not see).',
  type: ErrorResponseDto,
})
@UseGuards(WorkspaceAccessGuard)
@Controller({ path: 'workspaces/:workspaceId/conversations', version: '1' })
export class ConversationsController {
  constructor(
    private readonly inbox: InboxService,
    private readonly stream: InboxStreamService,
    private readonly media: InboxMediaService,
  ) {}

  @Get('options')
  @RequirePermissions('messages.read')
  @ApiOkResponse({ type: InboxOptionsDto })
  @ApiOperation({
    summary: 'Visible lines and permitted assignment recipients',
  })
  options(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
  ) {
    return this.inbox.options(actor(auth, workspace));
  }

  @Get()
  @RequirePermissions('messages.read')
  @ApiOperation({
    summary: 'Conversations, most recent activity first',
    description:
      'Without conversations.view_all you only see conversations assigned to you and the unassigned ones of the lines you attend.',
  })
  @ApiOkResponse({ type: ConversationPageDto })
  list(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ConversationPageDto> {
    return this.inbox.list(actor(auth, workspace), query);
  }

  @Get('counts')
  @RequirePermissions('messages.read')
  @ApiOperation({ summary: 'Counters for the inbox tabs and the unread badge' })
  @ApiOkResponse({ type: InboxCountsDto })
  counts(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
  ): Promise<InboxCountsDto> {
    return this.inbox.counts(actor(auth, workspace));
  }

  @Sse('events')
  @RequirePermissions('messages.read')
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Real-time inbox events (server-sent events)',
    description:
      'Events: conversation.updated, conversation.removed (no longer visible to you), message.created, message.updated and ping every 25 s. Send the Bearer token in the Authorization header (use fetch streaming: EventSource cannot set headers).',
  })
  events(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Headers('authorization') authorization: string,
  ): Observable<MessageEvent> {
    return this.stream.stream(
      actor(auth, workspace),
      authorization.split(' ')[1] ?? '',
    );
  }

  @Get(':conversationId')
  @RequirePermissions('messages.read')
  @ApiOperation({ summary: 'One conversation' })
  @ApiOkResponse({ type: ConversationDto })
  get(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDto> {
    return this.inbox.get(actor(auth, workspace), conversationId);
  }

  @Get(':conversationId/messages')
  @RequirePermissions('messages.read')
  @ApiOperation({
    summary: 'Messages and notes of a conversation, newest first',
  })
  @ApiOkResponse({ type: MessagePageDto })
  messages(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<MessagePageDto> {
    return this.inbox.messages(
      actor(auth, workspace),
      conversationId,
      query.cursor,
      query.limit,
    );
  }

  @Post(':conversationId/messages')
  @RequirePermissions('messages.send')
  @ApiOperation({
    summary: 'Reply through WhatsApp',
    description:
      'Takes the conversation if nobody has it. Only within 24 h of the customer\'s last message (409 WINDOW_CLOSED) and with an active plan (402 SUBSCRIPTION_INACTIVE). If Meta rejects the message it is stored with status "failed" and the reason in `error`.',
  })
  @ApiCreatedResponse({ type: MessageDto })
  @ApiConflictResponse({
    description:
      'CONVERSATION_CLOSED, WINDOW_CLOSED, LINE_UNAVAILABLE or CONTACT_LIMIT_REACHED.',
    type: ErrorResponseDto,
  })
  reply(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendTextDto,
  ): Promise<MessageDto> {
    return this.inbox.reply(
      actor(auth, workspace),
      conversationId,
      dto.text,
      dto.clientId ?? null,
    );
  }

  @Post(':conversationId/messages/:messageId/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('messages.send')
  @ApiOperation({
    summary: 'Send a message that was not delivered again',
    description:
      'Only outgoing messages with status "failed" (409 MESSAGE_NOT_RETRYABLE); the same message is reused with the same text, file or contacts. Same rules as a reply.',
  })
  @ApiOkResponse({ type: MessageDto })
  @ApiConflictResponse({
    description:
      'MESSAGE_NOT_RETRYABLE, CONVERSATION_CLOSED, WINDOW_CLOSED, LINE_UNAVAILABLE or CONTACT_LIMIT_REACHED.',
    type: ErrorResponseDto,
  })
  retry(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ): Promise<MessageDto> {
    return this.inbox.retry(actor(auth, workspace), conversationId, messageId);
  }

  @Get(':conversationId/messages/:messageId/media')
  @RequirePermissions('messages.read')
  @ApiProduces('application/octet-stream')
  @ApiOperation({
    summary: 'The file of a message (image, audio, video, sticker, document)',
    description:
      'Streams our stored copy; files customers sent are copied from Meta on arrival or on first view (502 MEDIA_UNAVAILABLE if Meta no longer has it). Content-Type is limited to known media types; other files are downloads.',
  })
  async messageMedia(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const conversation = await this.inbox.visible(
      actor(auth, workspace),
      conversationId,
    );
    const file = await this.media.open(conversation, messageId);
    response.set(mediaHeaders(file));
    return new StreamableFile(file.stream);
  }

  @Post(':conversationId/media')
  @RequirePermissions('messages.send')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_MEDIA_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        caption: { type: 'string', maxLength: 1024 },
      },
    },
  })
  @ApiOperation({
    summary: 'Send a file through WhatsApp',
    description:
      'Same rules as a text reply. Images JPG/PNG up to 5 MB; MP4/3GPP video, AAC/AMR/MP3/MP4/OGG audio and PDF/Office/TXT documents up to 16 MB (415 UNSUPPORTED_MEDIA_TYPE, 413 MEDIA_TOO_LARGE).',
  })
  @ApiCreatedResponse({ type: MessageDto })
  sendMedia(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: SendMediaDto,
  ): Promise<MessageDto> {
    if (!file) {
      throw new BadRequestException({
        message: 'Attach the file in the "file" field',
        code: 'FILE_REQUIRED',
      });
    }
    return this.inbox.sendMedia(
      actor(auth, workspace),
      conversationId,
      {
        buffer: file.buffer,
        mimeType: file.mimetype,
        // Browsers send UTF-8 names; busboy (multer) decodes them as latin1.
        filename: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        size: file.size,
      },
      dto.caption || null,
      dto.clientId ?? null,
    );
  }

  @Post(':conversationId/contacts')
  @RequirePermissions('messages.send')
  @ApiOperation({
    summary: 'Send contact cards through WhatsApp',
    description:
      'Same rules as a text reply. The customer can save the contacts or write to them (400 INVALID_PHONE).',
  })
  @ApiCreatedResponse({ type: MessageDto })
  sendContacts(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendContactsDto,
  ): Promise<MessageDto> {
    return this.inbox.sendContacts(
      actor(auth, workspace),
      conversationId,
      dto.contacts,
      dto.clientId ?? null,
    );
  }

  @Post(':conversationId/notes')
  @RequirePermissions('messages.send')
  @ApiOperation({
    summary: 'Internal note for the team (not sent to WhatsApp)',
  })
  @ApiCreatedResponse({ type: MessageDto })
  note(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendTextDto,
  ): Promise<MessageDto> {
    return this.inbox.note(
      actor(auth, workspace),
      conversationId,
      dto.text,
      dto.clientId ?? null,
    );
  }

  @Post(':conversationId/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('conversations.assign')
  @ApiOperation({
    summary: 'Assign or transfer to an active member, or unassign',
  })
  @ApiOkResponse({ type: ConversationDto })
  assign(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @Body() dto: AssignConversationDto,
  ): Promise<ConversationDto> {
    return this.inbox.assign(
      actor(auth, workspace),
      conversationId,
      dto.membershipId,
    );
  }

  @Post(':conversationId/take')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('messages.send')
  @ApiOperation({ summary: 'Take an unassigned conversation ("Tomar chat")' })
  @ApiOkResponse({ type: ConversationDto })
  @ApiConflictResponse({
    description: 'ALREADY_ASSIGNED.',
    type: ErrorResponseDto,
  })
  take(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDto> {
    return this.inbox.take(actor(auth, workspace), conversationId);
  }

  @Post(':conversationId/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('messages.send')
  @ApiOperation({ summary: 'Close the conversation' })
  @ApiOkResponse({ type: ConversationDto })
  close(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDto> {
    return this.inbox.setStatus(
      actor(auth, workspace),
      conversationId,
      'CLOSED',
    );
  }

  @Post(':conversationId/hold')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('messages.send')
  @ApiOperation({
    summary: 'Put the conversation on hold ("En espera")',
    description:
      'It stays on hold when the customer writes (messages still count as unread); reopen it to bring it back to Open.',
  })
  @ApiOkResponse({ type: ConversationDto })
  hold(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDto> {
    return this.inbox.setStatus(
      actor(auth, workspace),
      conversationId,
      'ON_HOLD',
    );
  }

  @Post(':conversationId/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('messages.send')
  @ApiOperation({
    summary: 'Reopen the conversation (from closed or on hold)',
  })
  @ApiOkResponse({ type: ConversationDto })
  reopen(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDto> {
    return this.inbox.setStatus(actor(auth, workspace), conversationId, 'OPEN');
  }

  @Put(':conversationId/tags')
  @RequirePermissions('contacts.write')
  @ApiOperation({
    summary: 'Tag the chat',
    description:
      'Replaces the tags of the contact of the conversation (the same tags as in Contactos). Emits conversation.updated so lists refresh.',
  })
  @ApiOkResponse({ type: ConversationDto })
  setTags(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @Body() dto: SetContactTagsDto,
  ): Promise<ConversationDto> {
    return this.inbox.setTags(
      actor(auth, workspace),
      conversationId,
      dto.tagIds,
    );
  }

  @Post(':conversationId/unread')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('messages.read')
  @ApiOperation({ summary: 'Mark the conversation as unread' })
  @ApiOkResponse({ type: ConversationDto })
  unread(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDto> {
    return this.inbox.markUnread(actor(auth, workspace), conversationId);
  }

  @Post(':conversationId/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('messages.read')
  @ApiOperation({ summary: 'Mark the conversation as read' })
  @ApiOkResponse({ type: ConversationDto })
  read(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDto> {
    return this.inbox.markRead(actor(auth, workspace), conversationId);
  }

  @Post(':conversationId/bot/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('messages.send')
  @ApiOperation({
    summary: "Turn the line's chatbot off in this chat",
    description:
      'The chatbot stops answering this customer for 24 hours (it turns on again by itself) or permanently, until an agent turns it on again. It stays off if the chat is closed and the customer writes again.',
  })
  @ApiOkResponse({ type: ConversationDto })
  pauseBot(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
    @Body() body: PauseBotDto,
  ): Promise<ConversationDto> {
    return this.inbox.pauseBot(
      actor(auth, workspace),
      conversationId,
      body.duration ?? '24h',
    );
  }

  @Post(':conversationId/bot/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('messages.send')
  @ApiOperation({
    summary: "Turn the line's chatbot back on in this chat",
    description: 'It answers the next message from the start of its flow.',
  })
  @ApiOkResponse({ type: ConversationDto })
  resumeBot(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDto> {
    return this.inbox.resumeBot(actor(auth, workspace), conversationId);
  }
}

@ApiTags('inbox')
@ApiBearerAuth(SWAGGER_BEARER)
@UseGuards(WorkspaceAccessGuard)
@Controller({
  path: 'workspaces/:workspaceId/channels/auto-assignment',
  version: '1',
})
export class AutoAssignmentController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @RequirePermissions('channels.manage')
  @ApiOkResponse({ type: AutoAssignmentOptionsDto })
  @ApiOperation({
    summary: 'Auto-assignment settings and active members, without credentials',
  })
  options(@CurrentWorkspace() workspace: WorkspaceAccess) {
    return this.inbox.autoAssignmentOptions(workspace.workspaceId);
  }
}

@ApiTags('contacts')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@UseGuards(WorkspaceAccessGuard)
@Controller({
  path: 'workspaces/:workspaceId/contacts/:contactId',
  version: '1',
})
export class ContactBlockController {
  constructor(private readonly blocks: ContactBlockService) {}

  @Post('block')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contacts.write')
  @ApiOperation({
    summary: 'Block a contact',
    description:
      'Their WhatsApp messages are ignored, their open chats are closed with a notice, and the number is blocked on WhatsApp on every line they wrote to. Meta only blocks users who wrote in the last 24 h: see `whatsapp[].ok`.',
  })
  @ApiOkResponse({ type: BlockResultDto })
  @ApiNotFoundResponse({
    description: 'CONTACT_NOT_FOUND',
    type: ErrorResponseDto,
  })
  block(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('contactId') contactId: string,
  ): Promise<BlockResultDto> {
    return this.blocks.setBlocked(actor(auth, workspace), contactId, true);
  }

  @Post('unblock')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contacts.write')
  @ApiOperation({ summary: 'Unblock a contact (in the CRM and on WhatsApp)' })
  @ApiOkResponse({ type: BlockResultDto })
  @ApiNotFoundResponse({
    description: 'CONTACT_NOT_FOUND',
    type: ErrorResponseDto,
  })
  unblock(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('contactId') contactId: string,
  ): Promise<BlockResultDto> {
    return this.blocks.setBlocked(actor(auth, workspace), contactId, false);
  }
}
