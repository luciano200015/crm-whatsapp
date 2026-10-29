import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../../../shared/http/error-response.dto';
import {
  ReqContext,
  type RequestContext,
} from '../../../shared/http/request-context';
import { SWAGGER_BEARER } from '../../../shared/http/swagger';
import type { AuthContext } from '../../auth/application/auth.service';
import { CurrentUser } from '../../auth/presentation/auth.decorators';
import type { WorkspaceAccess } from '../../authorization/application/authorization.service';
import {
  CurrentWorkspace,
  RequirePermissions,
} from '../../authorization/presentation/workspace-access.decorators';
import { WorkspaceAccessGuard } from '../../authorization/presentation/workspace-access.guard';
import { MAX_MEDIA_BYTES, mediaHeaders } from '../../inbox/application/media';
import { ChatbotsService } from '../application/chatbots.service';
import {
  ApiTestResultDto,
  BotMediaDto,
  ChatbotDto,
  ChatbotSummaryDto,
  CreateChatbotDto,
  SetChatbotLinesDto,
  SimulateChatbotDto,
  SimulationDto,
  TestApiRequestDto,
  UpdateChatbotDto,
} from './chatbots.dto';

const ID = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

@ApiTags('chatbots')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Missing chatbots.manage, or FEATURE_NOT_IN_PLAN.',
  type: ErrorResponseDto,
})
@ApiNotFoundResponse({
  description: 'Not a member of the workspace, or CHATBOT_NOT_FOUND.',
  type: ErrorResponseDto,
})
@UseGuards(WorkspaceAccessGuard)
@RequirePermissions('chatbots.manage')
@Controller({ path: 'workspaces/:workspaceId/chatbots', version: '1' })
export class ChatbotsController {
  constructor(private readonly chatbots: ChatbotsService) {}

  @Get()
  @ApiOperation({ summary: 'Chatbots of the workspace, with their lines' })
  @ApiOkResponse({ type: [ChatbotSummaryDto] })
  list(
    @CurrentWorkspace() workspace: WorkspaceAccess,
  ): Promise<ChatbotSummaryDto[]> {
    return this.chatbots.list(workspace.workspaceId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a chatbot',
    description:
      'It starts turned off, with a greeting after the start node and no lines.',
  })
  @ApiCreatedResponse({ type: ChatbotDto })
  create(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Body() dto: CreateChatbotDto,
    @ReqContext() context: RequestContext,
  ): Promise<ChatbotDto> {
    return this.chatbots.create(workspace.workspaceId, dto.name, {
      userId: auth.userId,
      context,
    });
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Try a flow ("Probar chatbot")',
    description:
      'Runs the flow for one answer of a pretend customer. Nothing is sent to WhatsApp and nothing changes.',
  })
  @ApiOkResponse({ type: SimulationDto })
  simulate(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Body() dto: SimulateChatbotDto,
  ): Promise<SimulationDto> {
    return this.chatbots.simulate(workspace.workspaceId, {
      graph: dto.graph,
      session: dto.session ?? null,
      text: dto.text ?? null,
      replyId: dto.replyId ?? null,
      contactName: dto.contactName ?? null,
      fallbackText: dto.fallbackText ?? '',
      restartKeywords: dto.restartKeywords ?? [],
      variables: dto.variables ?? [],
    });
  }

  @Post('test-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '«Probar conexión» of a «Consulta API»',
    description:
      'Calls the service with test values for its variables (HTTPS, public addresses only, 10 s, 100 KB). Up to 10 per minute per user.',
  })
  @ApiOkResponse({ type: ApiTestResultDto })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  testRequest(
    @CurrentUser() auth: AuthContext,
    @Body() dto: TestApiRequestDto,
  ): Promise<ApiTestResultDto> {
    return this.chatbots.testRequest(auth.userId, dto.api, dto.sample ?? {});
  }

  @Get(':chatbotId')
  @ApiOperation({
    summary: 'One chatbot with its flow',
    description:
      '`issues` lists what to fix: errors keep it from being turned on.',
  })
  @ApiOkResponse({ type: ChatbotDto })
  get(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('chatbotId', ID) chatbotId: string,
  ): Promise<ChatbotDto> {
    return this.chatbots.get(workspace.workspaceId, chatbotId);
  }

  @Patch(':chatbotId')
  @ApiOperation({
    summary:
      'Save the flow, the settings (hours, messages, variables…) or turn the chatbot on/off',
  })
  @ApiOkResponse({ type: ChatbotDto })
  @ApiConflictResponse({
    description: 'FLOW_INCOMPLETE: fix the errors before turning it on.',
    type: ErrorResponseDto,
  })
  update(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('chatbotId', ID) chatbotId: string,
    @Body() dto: UpdateChatbotDto,
    @ReqContext() context: RequestContext,
  ): Promise<ChatbotDto> {
    return this.chatbots.update(workspace.workspaceId, chatbotId, dto, {
      userId: auth.userId,
      context,
    });
  }

  @Delete(':chatbotId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a chatbot',
    description: 'Its lines are left without a chatbot.',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('chatbotId', ID) chatbotId: string,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.chatbots.remove(workspace.workspaceId, chatbotId, {
      userId: auth.userId,
      context,
    });
  }

  @Post(':chatbotId/duplicate')
  @ApiOperation({
    summary: 'Copy a chatbot',
    description: 'The copy is turned off and has no lines.',
  })
  @ApiCreatedResponse({ type: ChatbotDto })
  duplicate(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('chatbotId', ID) chatbotId: string,
    @ReqContext() context: RequestContext,
  ): Promise<ChatbotDto> {
    return this.chatbots.duplicate(workspace.workspaceId, chatbotId, {
      userId: auth.userId,
      context,
    });
  }

  @Put(':chatbotId/lines')
  @ApiOperation({
    summary: 'The lines the chatbot answers on',
    description:
      'One chatbot per line, so two bots never answer the same customer. A line of another chatbot gives 409 LINE_HAS_CHATBOT unless `takeOver` is true.',
  })
  @ApiOkResponse({ type: ChatbotDto })
  @ApiConflictResponse({
    description: 'LINE_HAS_CHATBOT.',
    type: ErrorResponseDto,
  })
  setLines(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('chatbotId', ID) chatbotId: string,
    @Body() dto: SetChatbotLinesDto,
    @ReqContext() context: RequestContext,
  ): Promise<ChatbotDto> {
    return this.chatbots.setLines(
      workspace.workspaceId,
      chatbotId,
      dto.lineIds,
      dto.takeOver ?? false,
      { userId: auth.userId, context },
    );
  }

  @Post(':chatbotId/media')
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
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload a file for a message of the chatbot',
    description:
      'Same file types and sizes WhatsApp accepts (415 UNSUPPORTED_MEDIA_TYPE, 413 MEDIA_TOO_LARGE). Put the result in the `media` of a message node.',
  })
  @ApiCreatedResponse({ type: BotMediaDto })
  uploadMedia(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('chatbotId', ID) chatbotId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<BotMediaDto> {
    if (!file) {
      throw new BadRequestException({
        message: 'Attach the file in the "file" field',
        code: 'FILE_REQUIRED',
      });
    }
    return this.chatbots.uploadMedia(workspace.workspaceId, chatbotId, {
      buffer: file.buffer,
      mimeType: file.mimetype,
      // Browsers send UTF-8 names; busboy (multer) decodes them as latin1.
      filename: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      size: file.size,
    });
  }

  @Get(':chatbotId/media/:fileId')
  @ApiProduces('application/octet-stream')
  @ApiOperation({ summary: 'A file uploaded for the chatbot' })
  async media(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('chatbotId', ID) chatbotId: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.chatbots.openMedia(
      workspace.workspaceId,
      chatbotId,
      fileId,
    );
    response.set(mediaHeaders(file));
    return new StreamableFile(file.stream);
  }
}
