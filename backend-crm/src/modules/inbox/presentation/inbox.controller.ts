import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  type MessageEvent,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
import { InboxService, type InboxActor } from '../application/inbox.service';
import { InboxStreamService } from '../application/inbox-stream.service';
import {
  AssignConversationDto,
  InboxOptionsDto,
  AutoAssignmentOptionsDto,
  ConversationDto,
  ConversationPageDto,
  InboxCountsDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  MessageDto,
  MessagePageDto,
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
    return this.inbox.reply(actor(auth, workspace), conversationId, dto.text);
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
    return this.inbox.note(actor(auth, workspace), conversationId, dto.text);
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

  @Post(':conversationId/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('messages.send')
  @ApiOperation({
    summary: 'Reopen the conversation',
    description:
      '409 CONVERSATION_ALREADY_OPEN if the contact already has another open conversation on the line.',
  })
  @ApiOkResponse({ type: ConversationDto })
  reopen(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDto> {
    return this.inbox.setStatus(actor(auth, workspace), conversationId, 'OPEN');
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
