import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponseDto } from '../../../shared/http/error-response.dto';
import {
  ReqContext,
  type RequestContext,
} from '../../../shared/http/request-context';
import { SWAGGER_BEARER } from '../../../shared/http/swagger';
import type { AuthContext } from '../../auth/application/auth.service';
import { CurrentUser, Public } from '../../auth/presentation/auth.decorators';
import type { WorkspaceAccess } from '../../authorization/application/authorization.service';
import {
  CurrentWorkspace,
  RequirePermissions,
} from '../../authorization/presentation/workspace-access.decorators';
import { WorkspaceAccessGuard } from '../../authorization/presentation/workspace-access.guard';
import { ChannelsService } from '../application/channels.service';
import { WhatsAppWebhookService } from '../application/whatsapp-webhook.service';
import {
  CreateLineDto,
  LineDto,
  SetLineAgentsDto,
  UpdateLineDto,
} from './channels.dto';

const ID = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

@ApiTags('channels')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Missing permission.',
  type: ErrorResponseDto,
})
@ApiNotFoundResponse({
  description: 'Not a member of the workspace, or LINE_NOT_FOUND.',
  type: ErrorResponseDto,
})
@UseGuards(WorkspaceAccessGuard)
@Controller({ path: 'workspaces/:workspaceId/channels/lines', version: '1' })
export class LinesController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @RequirePermissions('channels.read')
  @ApiOperation({
    summary: 'WhatsApp lines of the workspace',
    description:
      'Credentials are never returned. `webhook` (URL and verify token for Meta) is only included with channels.manage.',
  })
  @ApiOkResponse({ type: [LineDto] })
  list(@CurrentWorkspace() workspace: WorkspaceAccess): Promise<LineDto[]> {
    return this.channels.list(
      workspace.workspaceId,
      workspace.permissions.has('channels.manage'),
    );
  }

  @Get(':lineId')
  @RequirePermissions('channels.read')
  @ApiOperation({ summary: 'One line' })
  @ApiOkResponse({ type: LineDto })
  get(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('lineId', ID) lineId: string,
  ): Promise<LineDto> {
    return this.channels.get(
      workspace.workspaceId,
      lineId,
      workspace.permissions.has('channels.manage'),
    );
  }

  @Post()
  @RequirePermissions('channels.manage')
  @ApiOperation({
    summary: 'Connect a WhatsApp number (Cloud API credentials)',
    description:
      'Needs an active plan (402 SUBSCRIPTION_INACTIVE) and room in limits.whatsapp_lines (409 LINE_LIMIT_REACHED). The access token and App Secret are stored encrypted. Then paste `webhook.url` and `webhook.verifyToken` in Meta and use POST …/test.',
  })
  @ApiCreatedResponse({ type: LineDto })
  @ApiConflictResponse({
    description: 'LINE_LIMIT_REACHED or PHONE_NUMBER_ID_TAKEN.',
    type: ErrorResponseDto,
  })
  @ApiResponse({ status: HttpStatus.PAYMENT_REQUIRED, type: ErrorResponseDto })
  create(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Body() dto: CreateLineDto,
    @ReqContext() context: RequestContext,
  ): Promise<LineDto> {
    return this.channels.create(workspace.workspaceId, dto, {
      userId: auth.userId,
      context,
    });
  }

  @Patch(':lineId')
  @RequirePermissions('channels.manage')
  @ApiOperation({
    summary:
      'Edit a line, replace credentials, enable/disable it or toggle auto-assignment',
    description:
      'New credentials put the line back to PENDING until it is tested.',
  })
  @ApiOkResponse({ type: LineDto })
  @ApiConflictResponse({
    description: 'PHONE_NUMBER_ID_TAKEN.',
    type: ErrorResponseDto,
  })
  update(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('lineId', ID) lineId: string,
    @Body() dto: UpdateLineDto,
    @ReqContext() context: RequestContext,
  ): Promise<LineDto> {
    return this.channels.update(workspace.workspaceId, lineId, dto, {
      userId: auth.userId,
      context,
    });
  }

  @Post(':lineId/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('channels.manage')
  @ApiOperation({
    summary: 'Check the credentials against Meta',
    description:
      'CONNECTED with the verified number and name, or ERROR with the message from Meta in `lastError`.',
  })
  @ApiOkResponse({ type: LineDto })
  test(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('lineId', ID) lineId: string,
  ): Promise<LineDto> {
    return this.channels.test(workspace.workspaceId, lineId);
  }

  @Put(':lineId/agents')
  @RequirePermissions('channels.manage')
  @ApiOperation({
    summary: 'Agents who attend the line',
    description:
      'They see its unassigned chats and receive new ones when auto-assignment is on. Only active members of the workspace.',
  })
  @ApiOkResponse({ type: LineDto })
  setAgents(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('lineId', ID) lineId: string,
    @Body() dto: SetLineAgentsDto,
  ): Promise<LineDto> {
    return this.channels.setAgents(
      workspace.workspaceId,
      lineId,
      dto.membershipIds,
    );
  }

  @Delete(':lineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('channels.manage')
  @ApiOperation({
    summary: 'Delete a line',
    description: 'Its conversations stay in the inbox history.',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('lineId', ID) lineId: string,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.channels.remove(workspace.workspaceId, lineId, {
      userId: auth.userId,
      context,
    });
  }
}

/** Called by Meta, not by users: public, authenticated by the verify token and the signature. */
@ApiTags('webhooks')
@Public()
@Controller({ path: 'webhooks/whatsapp', version: '1' })
export class WhatsAppWebhookController {
  constructor(private readonly webhook: WhatsAppWebhookService) {}

  @Get(':lineId')
  @Header('Content-Type', 'text/plain')
  @ApiOperation({
    summary: 'Meta webhook verification (hub.challenge)',
    description:
      'Meta calls it when you save the callback URL. Answers hub.challenge if hub.verify_token matches the line; 403 otherwise.',
  })
  @ApiParam({ name: 'lineId', format: 'uuid' })
  verify(
    @Param('lineId', ID) lineId: string,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): Promise<string> {
    return this.webhook.verify(lineId, mode, token, challenge);
  }

  @Post(':lineId')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receive(
    @Param('lineId', ID) lineId: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<{ received: true }> {
    await this.webhook.receive(lineId, request.rawBody, signature);
    return { received: true };
  }
}
