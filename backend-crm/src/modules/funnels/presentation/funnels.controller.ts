import {
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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
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
import {
  FunnelsService,
  type FunnelActor,
} from '../application/funnels.service';
import type { BoardFilters } from '../domain/funnel-rules';
import {
  AddLeadDto,
  ArchiveLeadDto,
  AutomationQueryDto,
  AutomationRulesDto,
  AutomationRuleViewDto,
  BoardDto,
  BoardPreferencesDto,
  BoardQueryDto,
  BulkLeadsDto,
  BulkResultDto,
  ContactFunnelDto,
  CreateFunnelDto,
  DeleteFunnelQueryDto,
  DeleteStageQueryDto,
  FunnelDto,
  FunnelPermissionsDto,
  FunnelPermissionsViewDto,
  FunnelSummaryDto,
  LeadAmountDto,
  LeadDto,
  LeadPageDto,
  MoveLeadDto,
  SetContactStageDto,
  StageLeadsQueryDto,
  StageNameDto,
  StageOrderDto,
  SyncFunnelDto,
  SyncResultDto,
  UpdateFunnelDto,
} from './funnels.dto';

const ID = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

const actorOf = (
  workspace: WorkspaceAccess,
  auth: AuthContext,
  context: RequestContext,
): FunnelActor => ({ userId: auth.userId, access: workspace, context });

function filtersOf(query: BoardQueryDto): BoardFilters {
  return {
    search: query.search || undefined,
    agentIds: query.agentIds,
    unassigned: query.unassigned,
    tagIds: query.tagIds,
    statuses: query.statuses,
    archived: query.archived,
    minCents: query.minCents,
    maxCents: query.maxCents,
    sort: query.sort,
  };
}

@ApiTags('funnels')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({
  description:
    'Missing funnels.read / funnels.write / funnels.manage, FEATURE_NOT_IN_PLAN or STAGE_FORBIDDEN.',
  type: ErrorResponseDto,
})
@ApiNotFoundResponse({
  description:
    'Not a member, FUNNEL_NOT_FOUND (also for funnels of lines you do not attend), STAGE_NOT_FOUND or LEAD_NOT_FOUND.',
  type: ErrorResponseDto,
})
@UseGuards(WorkspaceAccessGuard)
@RequirePermissions('funnels.read')
@Controller({ path: 'workspaces/:workspaceId/funnels', version: '1' })
export class FunnelsController {
  constructor(private readonly funnels: FunnelsService) {}

  @Get()
  @ApiOperation({
    summary: 'Funnels of the lines you see',
    description:
      'Every line with conversations.view_all; otherwise the lines you attend.',
  })
  @ApiOkResponse({ type: [FunnelSummaryDto] })
  list(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
  ): Promise<FunnelSummaryDto[]> {
    return this.funnels.list(actorOf(workspace, auth, context));
  }

  @Post()
  @RequirePermissions('funnels.manage')
  @ApiOperation({
    summary: 'Create a funnel ("Nuevo embudo")',
    description:
      'With defaultStages it starts with Nuevo, En atención, Esperando cliente and Cerrado, all in one transaction.',
  })
  @ApiCreatedResponse({ type: FunnelDto })
  @ApiConflictResponse({
    description: 'FUNNEL_NAME_TAKEN or LINE_DISABLED.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Body() dto: CreateFunnelDto,
  ): Promise<FunnelDto> {
    return this.funnels.create(actorOf(workspace, auth, context), dto);
  }

  @Get('contacts/:contactId')
  @ApiOperation({
    summary: 'The funnels of a contact (chat stage selector)',
    description:
      'Every funnel you see, with the lead of the contact in it (lead: null when it is not there).',
  })
  @ApiOkResponse({ type: [ContactFunnelDto] })
  contactFunnels(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('contactId') contactId: string,
  ): Promise<ContactFunnelDto[]> {
    return this.funnels.contactFunnels(
      actorOf(workspace, auth, context),
      contactId,
    );
  }

  @Put('contacts/:contactId')
  @RequirePermissions('funnels.write')
  @ApiOperation({
    summary: 'Put the contact in a stage of a funnel (adds or moves its lead)',
  })
  @ApiOkResponse({ type: [ContactFunnelDto] })
  setContactStage(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('contactId') contactId: string,
    @Body() dto: SetContactStageDto,
  ): Promise<ContactFunnelDto[]> {
    return this.funnels.setContactStage(
      actorOf(workspace, auth, context),
      contactId,
      dto.funnelId,
      dto.stageId,
    );
  }

  @Get(':funnelId')
  @ApiOperation({ summary: 'A funnel with the stages you see' })
  @ApiOkResponse({ type: FunnelDto })
  get(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
  ): Promise<FunnelDto> {
    return this.funnels.get(actorOf(workspace, auth, context), funnelId);
  }

  @Patch(':funnelId')
  @RequirePermissions('funnels.manage')
  @ApiOperation({ summary: 'Edit a funnel ("Editar embudo")' })
  @ApiOkResponse({ type: FunnelDto })
  @ApiConflictResponse({
    description:
      'FUNNEL_HAS_LEADS (another line while it has leads), FUNNEL_NAME_TAKEN or LINE_DISABLED.',
    type: ErrorResponseDto,
  })
  update(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Body() dto: UpdateFunnelDto,
  ): Promise<FunnelDto> {
    return this.funnels.update(
      actorOf(workspace, auth, context),
      funnelId,
      dto,
    );
  }

  @Delete(':funnelId')
  @RequirePermissions('funnels.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a funnel',
    description:
      'Its leads go with it; contacts and conversations stay. With leads it needs ?confirm=true.',
  })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    description: 'FUNNEL_HAS_LEADS.',
    type: ErrorResponseDto,
  })
  async remove(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Query() query: DeleteFunnelQueryDto,
  ): Promise<void> {
    await this.funnels.remove(
      actorOf(workspace, auth, context),
      funnelId,
      query.confirm ?? false,
    );
  }

  @Post(':funnelId/stages')
  @RequirePermissions('funnels.manage')
  @ApiOperation({ summary: 'Add a stage after the last one' })
  @ApiCreatedResponse({ type: FunnelDto })
  @ApiConflictResponse({ description: 'STAGE_LIMIT.', type: ErrorResponseDto })
  addStage(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Body() dto: StageNameDto,
  ): Promise<FunnelDto> {
    return this.funnels.addStage(
      actorOf(workspace, auth, context),
      funnelId,
      dto.name,
    );
  }

  @Put(':funnelId/stages/order')
  @RequirePermissions('funnels.manage')
  @ApiOperation({
    summary: 'Reorder the stages',
    description: 'Send every stage once; leads keep their stage.',
  })
  @ApiOkResponse({ type: FunnelDto })
  reorderStages(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Body() dto: StageOrderDto,
  ): Promise<FunnelDto> {
    return this.funnels.reorderStages(
      actorOf(workspace, auth, context),
      funnelId,
      dto.stageIds,
    );
  }

  @Patch(':funnelId/stages/:stageId')
  @RequirePermissions('funnels.manage')
  @ApiOperation({ summary: 'Rename a stage' })
  @ApiOkResponse({ type: FunnelDto })
  renameStage(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Param('stageId', ID) stageId: string,
    @Body() dto: StageNameDto,
  ): Promise<FunnelDto> {
    return this.funnels.renameStage(
      actorOf(workspace, auth, context),
      funnelId,
      stageId,
      dto.name,
    );
  }

  @Delete(':funnelId/stages/:stageId')
  @RequirePermissions('funnels.manage')
  @ApiOperation({
    summary: 'Delete a stage',
    description:
      'Its leads move to `moveTo` first (required when it has leads); contacts are never deleted.',
  })
  @ApiOkResponse({ type: FunnelDto })
  @ApiConflictResponse({
    description: 'STAGE_HAS_LEADS or LAST_STAGE.',
    type: ErrorResponseDto,
  })
  removeStage(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Param('stageId', ID) stageId: string,
    @Query() query: DeleteStageQueryDto,
  ): Promise<FunnelDto> {
    return this.funnels.removeStage(
      actorOf(workspace, auth, context),
      funnelId,
      stageId,
      query.moveTo,
    );
  }

  @Get(':funnelId/board')
  @ApiOperation({
    summary: 'The board: columns with counts, totals and their first leads',
    description:
      'Filters: AND between them, OR inside each list. Only the stages you see.',
  })
  @ApiOkResponse({ type: BoardDto })
  board(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Query() query: BoardQueryDto,
  ): Promise<BoardDto> {
    return this.funnels.board(
      actorOf(workspace, auth, context),
      funnelId,
      filtersOf(query),
    );
  }

  @Get(':funnelId/stages/:stageId/leads')
  @ApiOperation({ summary: 'More leads of a column ("Cargar más")' })
  @ApiOkResponse({ type: LeadPageDto })
  stageLeads(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Param('stageId', ID) stageId: string,
    @Query() query: StageLeadsQueryDto,
  ): Promise<LeadPageDto> {
    return this.funnels.stageLeads(
      actorOf(workspace, auth, context),
      funnelId,
      stageId,
      filtersOf(query),
      query.offset ?? 0,
    );
  }

  @Get(':funnelId/export.csv')
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Export the board to CSV',
    description:
      'Same filters and stages as the board. Columns: Nombre, Teléfono, Embudo, Etapa, Valor, Agente, Etiquetas, Estado del chat, Archivado, Creado, Última actividad. Up to 10 000 leads (413 EXPORT_TOO_LARGE).',
  })
  async exportCsv(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Query() query: BoardQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const file = await this.funnels.exportCsv(
      actorOf(workspace, auth, context),
      funnelId,
      filtersOf(query),
    );
    response.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
    });
    return file.content;
  }

  @Get(':funnelId/preferences')
  @ApiOperation({ summary: '"Personalizar tablero" (yours)' })
  @ApiOkResponse({ type: BoardPreferencesDto })
  preferences(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
  ): Promise<BoardPreferencesDto> {
    return this.funnels.preferences(
      actorOf(workspace, auth, context),
      funnelId,
    );
  }

  @Put(':funnelId/preferences')
  @ApiOperation({
    summary: 'Show or hide the value and the agent on the cards',
    description: 'Only hides them: the values stay stored.',
  })
  @ApiOkResponse({ type: BoardPreferencesDto })
  setPreferences(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Body() dto: BoardPreferencesDto,
  ): Promise<BoardPreferencesDto> {
    return this.funnels.setPreferences(
      actorOf(workspace, auth, context),
      funnelId,
      { showValue: dto.showValue, showAgent: dto.showAgent },
    );
  }

  @Post(':funnelId/leads')
  @RequirePermissions('funnels.write')
  @ApiOperation({ summary: 'Add a contact to the funnel ("Agregar lead")' })
  @ApiCreatedResponse({ type: LeadDto })
  @ApiConflictResponse({
    description: 'LEAD_EXISTS with the leadId to open it.',
    type: ErrorResponseDto,
  })
  addLead(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Body() dto: AddLeadDto,
  ): Promise<LeadDto> {
    return this.funnels.addLead(
      actorOf(workspace, auth, context),
      funnelId,
      dto.contactId,
      dto.stageId,
    );
  }

  @Post(':funnelId/leads/bulk')
  @RequirePermissions('funnels.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move, archive, restore or remove several leads',
    description:
      'The selected leads (leadIds) or every lead of a stage (stageId).',
  })
  @ApiOkResponse({ type: BulkResultDto })
  bulk(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Body() dto: BulkLeadsDto,
  ): Promise<BulkResultDto> {
    return this.funnels.bulk(actorOf(workspace, auth, context), funnelId, dto);
  }

  @Patch(':funnelId/leads/:leadId/stage')
  @RequirePermissions('funnels.write')
  @ApiOperation({ summary: 'Move a lead to another stage' })
  @ApiOkResponse({ type: LeadDto })
  @ApiConflictResponse({ description: 'LEAD_CHANGED.', type: ErrorResponseDto })
  moveLead(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Param('leadId') leadId: string,
    @Body() dto: MoveLeadDto,
  ): Promise<LeadDto> {
    return this.funnels.moveLead(
      actorOf(workspace, auth, context),
      funnelId,
      leadId,
      dto.stageId,
      dto.version,
    );
  }

  @Patch(':funnelId/leads/:leadId/amount')
  @RequirePermissions('funnels.write')
  @ApiOperation({ summary: 'Set the value of a lead ("Valor")' })
  @ApiOkResponse({ type: LeadDto })
  @ApiConflictResponse({ description: 'LEAD_CHANGED.', type: ErrorResponseDto })
  setAmount(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Param('leadId') leadId: string,
    @Body() dto: LeadAmountDto,
  ): Promise<LeadDto> {
    return this.funnels.setAmount(
      actorOf(workspace, auth, context),
      funnelId,
      leadId,
      dto.amountCents,
      dto.version,
    );
  }

  @Patch(':funnelId/leads/:leadId/archive')
  @RequirePermissions('funnels.write')
  @ApiOperation({
    summary: 'Archive or restore a lead',
    description:
      'It keeps its stage; archived leads show only with ?archived=true.',
  })
  @ApiOkResponse({ type: LeadDto })
  archiveLead(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Param('leadId') leadId: string,
    @Body() dto: ArchiveLeadDto,
  ): Promise<LeadDto> {
    return this.funnels.archiveLead(
      actorOf(workspace, auth, context),
      funnelId,
      leadId,
      dto.archived,
    );
  }

  @Delete(':funnelId/leads/:leadId')
  @RequirePermissions('funnels.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Take a lead out of the funnel',
    description: 'The contact and its conversations stay.',
  })
  @ApiNoContentResponse()
  async removeLead(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Param('leadId') leadId: string,
  ): Promise<void> {
    await this.funnels.removeLead(
      actorOf(workspace, auth, context),
      funnelId,
      leadId,
    );
  }

  @Get(':funnelId/permissions')
  @RequirePermissions('funnels.manage')
  @ApiOperation({
    summary: '"Privilegios del embudo": stages each member sees',
  })
  @ApiOkResponse({ type: FunnelPermissionsViewDto })
  permissions(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
  ): Promise<FunnelPermissionsViewDto> {
    return this.funnels.permissions(
      actorOf(workspace, auth, context),
      funnelId,
    );
  }

  @Put(':funnelId/permissions')
  @RequirePermissions('funnels.manage')
  @ApiOperation({
    summary: 'Save the privileges',
    description:
      'Replaces all of them at once. A member without stages sees every stage; with stages, only those (board, search, counts, export and moves).',
  })
  @ApiOkResponse({ type: FunnelPermissionsViewDto })
  setPermissions(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Body() dto: FunnelPermissionsDto,
  ): Promise<FunnelPermissionsViewDto> {
    return this.funnels.setPermissions(
      actorOf(workspace, auth, context),
      funnelId,
      dto.members,
    );
  }

  @Post(':funnelId/sync')
  @RequirePermissions('funnels.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '"Sincronizar contactos"',
    description:
      'Chats of the line in each status become leads of the stage. Contacts already in the funnel keep their stage.',
  })
  @ApiOkResponse({ type: SyncResultDto })
  sync(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Param('funnelId', ID) funnelId: string,
    @Body() dto: SyncFunnelDto,
  ): Promise<SyncResultDto> {
    return this.funnels.sync(
      actorOf(workspace, auth, context),
      funnelId,
      dto.rules,
    );
  }
}

@ApiTags('funnels')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@UseGuards(WorkspaceAccessGuard)
@RequirePermissions('funnels.manage')
@Controller({ path: 'workspaces/:workspaceId/funnel-automation', version: '1' })
export class FunnelAutomationController {
  constructor(private readonly funnels: FunnelsService) {}

  @Get()
  @ApiOperation({
    summary: '"Automatización de chat con embudos" of a line',
  })
  @ApiOkResponse({ type: [AutomationRuleViewDto] })
  rules(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Query() query: AutomationQueryDto,
  ): Promise<AutomationRuleViewDto[]> {
    return this.funnels.automationRules(
      actorOf(workspace, auth, context),
      query.lineId,
    );
  }

  @Put()
  @ApiOperation({
    summary: 'Save the rules of a line',
    description:
      'When a chat of the line changes to the status, its lead moves to the stage (added when missing). One rule per status; the funnel must be of the line.',
  })
  @ApiOkResponse({ type: [AutomationRuleViewDto] })
  setRules(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Query() query: AutomationQueryDto,
    @Body() dto: AutomationRulesDto,
  ): Promise<AutomationRuleViewDto[]> {
    return this.funnels.setAutomationRules(
      actorOf(workspace, auth, context),
      query.lineId,
      dto.rules,
    );
  }
}
