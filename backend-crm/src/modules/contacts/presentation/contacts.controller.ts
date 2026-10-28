import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Readable } from 'node:stream';
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
import { ContactsService } from '../application/contacts.service';
import {
  BulkContactsDto,
  BulkResultDto,
  ContactDto,
  ContactFieldDto,
  ContactPageDto,
  CreateContactDto,
  CreateContactFieldDto,
  CreateTagDto,
  DeleteAllContactsDto,
  DeleteAllResultDto,
  ExportContactsQueryDto,
  ImportContactsDto,
  ImportResultDto,
  LineAssignmentDto,
  ListContactsQueryDto,
  SetContactTagsDto,
  SetLineAgentsDto,
  TagDto,
  UpdateContactDto,
  UpdateContactFieldDto,
  UpdateTagDto,
} from './contacts.dto';

@ApiTags('contacts')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Missing permission.',
  type: ErrorResponseDto,
})
@ApiNotFoundResponse({
  description:
    'Not a member of the workspace, or CONTACT_NOT_FOUND / TAG_NOT_FOUND.',
  type: ErrorResponseDto,
})
@UseGuards(WorkspaceAccessGuard)
@Controller({ path: 'workspaces/:workspaceId/contacts', version: '1' })
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions('contacts.read')
  @ApiOperation({
    summary: 'List contacts, newest first (cursor pagination)',
  })
  @ApiOkResponse({ type: ContactPageDto })
  list(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Query() query: ListContactsQueryDto,
  ): Promise<ContactPageDto> {
    return this.contacts.list(workspace.workspaceId, query);
  }

  @Get('export.csv')
  @RequirePermissions('contacts.manage')
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: '«Exportar contactos» to CSV',
    description:
      'Without filters, every contact; with them, the same as the list. Columns: Nombre, Teléfono, Correo, Etiquetas, Estado, Origen, Notas, Último mensaje, Creado, Actualizado and one per custom field. UTF-8 with BOM, streamed.',
  })
  async exportCsv(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Query() query: ExportContactsQueryDto,
    @ReqContext() context: RequestContext,
  ): Promise<StreamableFile> {
    const file = await this.contacts.export(workspace.workspaceId, query, {
      userId: auth.userId,
      context,
    });
    return new StreamableFile(Readable.from(file.lines), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contacts.manage')
  @ApiOperation({
    summary: '«Importar contactos»: one batch of up to 200 mapped rows',
    description:
      'The app reads the CSV or Excel file, maps its columns and sends the rows in batches. A phone already in the workspace updates that contact with the non-empty values; tags are rewritten (REPLACE) or combined (MERGE), and missing tags are created. Each bad row fails alone.',
  })
  @ApiOkResponse({ type: ImportResultDto })
  import(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Body() dto: ImportContactsDto,
    @ReqContext() context: RequestContext,
  ): Promise<ImportResultDto> {
    return this.contacts.import(workspace.workspaceId, dto, {
      userId: auth.userId,
      context,
    });
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contacts.write')
  @ApiOperation({
    summary: 'Tag, untag or delete the selected contacts (up to 500)',
  })
  @ApiOkResponse({ type: BulkResultDto })
  bulk(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Body() dto: BulkContactsDto,
    @ReqContext() context: RequestContext,
  ): Promise<BulkResultDto> {
    return this.contacts.bulk(workspace.workspaceId, dto, {
      userId: auth.userId,
      context,
    });
  }

  @Post('delete-all')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('contacts.manage')
  @ApiOperation({
    summary: '«Eliminar todos los contactos»',
    description:
      'Needs { confirmation: "ELIMINAR" } (400 CONFIRMATION_REQUIRED). Conversations keep their copy of the name and phone; funnel leads of the contacts are removed.',
  })
  @ApiOkResponse({ type: DeleteAllResultDto })
  removeAll(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Body() dto: DeleteAllContactsDto,
    @ReqContext() context: RequestContext,
  ): Promise<DeleteAllResultDto> {
    return this.contacts.removeAll(workspace.workspaceId, dto.confirmation, {
      userId: auth.userId,
      context,
    });
  }

  @Get(':contactId')
  @RequirePermissions('contacts.read')
  @ApiOperation({ summary: 'One contact' })
  @ApiOkResponse({ type: ContactDto })
  get(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('contactId') contactId: string,
  ): Promise<ContactDto> {
    return this.contacts.get(workspace.workspaceId, contactId);
  }

  @Post()
  @RequirePermissions('contacts.write')
  @ApiOperation({
    summary: 'Create a contact',
    description:
      'The phone is normalized to E.164 and is unique in the workspace (409 CONTACT_PHONE_TAKEN). 400 INVALID_PHONE if it cannot be a real number.',
  })
  @ApiCreatedResponse({ type: ContactDto })
  @ApiConflictResponse({
    description: 'CONTACT_PHONE_TAKEN.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Body() dto: CreateContactDto,
    @ReqContext() context: RequestContext,
  ): Promise<ContactDto> {
    return this.contacts.create(workspace.workspaceId, dto, {
      userId: auth.userId,
      context,
    });
  }

  @Patch(':contactId')
  @RequirePermissions('contacts.write')
  @ApiOperation({ summary: 'Update a contact' })
  @ApiOkResponse({ type: ContactDto })
  @ApiConflictResponse({
    description: 'CONTACT_PHONE_TAKEN.',
    type: ErrorResponseDto,
  })
  update(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactDto,
  ): Promise<ContactDto> {
    return this.contacts.update(workspace.workspaceId, contactId, dto);
  }

  @Get(':contactId/agents')
  @RequirePermissions('contacts.read')
  @ApiOperation({
    summary: '«Asignación de asesores»: regular agent per line',
    description:
      'Every line that is not disabled, who can be the regular agent there, the chosen one and who attends the chat now (temporary).',
  })
  @ApiOkResponse({ type: [LineAssignmentDto] })
  agents(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('contactId') contactId: string,
  ): Promise<LineAssignmentDto[]> {
    return this.contacts.assignments(workspace.workspaceId, contactId);
  }

  @Put(':contactId/agents')
  @RequirePermissions('contacts.write')
  @ApiOperation({
    summary: 'Set the regular agent of some lines',
    description:
      'The agent must attend the line (404 CONTACT_AGENT_NOT_FOUND, CONTACT_LINE_NOT_FOUND). Used by «Asignar según el agente registrado».',
  })
  @ApiOkResponse({ type: ContactDto })
  setAgents(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('contactId') contactId: string,
    @Body() dto: SetLineAgentsDto,
  ): Promise<ContactDto> {
    return this.contacts.setLineAgents(
      workspace.workspaceId,
      contactId,
      dto.agents,
    );
  }

  @Put(':contactId/tags')
  @RequirePermissions('contacts.write')
  @ApiOperation({ summary: 'Replace the tags of a contact' })
  @ApiOkResponse({ type: ContactDto })
  setTags(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('contactId') contactId: string,
    @Body() dto: SetContactTagsDto,
  ): Promise<ContactDto> {
    return this.contacts.setTags(workspace.workspaceId, contactId, dto.tagIds);
  }

  @Delete(':contactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('contacts.write')
  @ApiOperation({ summary: 'Delete a contact' })
  @ApiNoContentResponse()
  async remove(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('contactId') contactId: string,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.contacts.remove(workspace.workspaceId, contactId, {
      userId: auth.userId,
      context,
    });
  }
}

@ApiTags('contacts')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Missing permission.',
  type: ErrorResponseDto,
})
@ApiNotFoundResponse({
  description: 'Not a member of the workspace, or TAG_NOT_FOUND.',
  type: ErrorResponseDto,
})
@UseGuards(WorkspaceAccessGuard)
@Controller({ path: 'workspaces/:workspaceId/tags', version: '1' })
export class TagsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions('contacts.read')
  @ApiOperation({
    summary: 'Tags of the workspace with their number of contacts',
  })
  @ApiOkResponse({ type: [TagDto] })
  list(@CurrentWorkspace() workspace: WorkspaceAccess): Promise<TagDto[]> {
    return this.contacts.listTags(workspace.workspaceId);
  }

  @Post()
  @RequirePermissions('tags.manage')
  @ApiOperation({
    summary: 'Create a tag',
    description:
      'Names are unique in the workspace ignoring case and accents (409 TAG_NAME_TAKEN).',
  })
  @ApiCreatedResponse({ type: TagDto })
  @ApiConflictResponse({
    description: 'TAG_NAME_TAKEN.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Body() dto: CreateTagDto,
  ): Promise<TagDto> {
    return this.contacts.createTag(workspace.workspaceId, dto);
  }

  @Patch(':tagId')
  @RequirePermissions('tags.manage')
  @ApiOperation({ summary: 'Rename or recolor a tag' })
  @ApiOkResponse({ type: TagDto })
  @ApiConflictResponse({
    description: 'TAG_NAME_TAKEN.',
    type: ErrorResponseDto,
  })
  update(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('tagId') tagId: string,
    @Body() dto: UpdateTagDto,
  ): Promise<TagDto> {
    return this.contacts.updateTag(workspace.workspaceId, tagId, dto);
  }

  @Delete(':tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('tags.manage')
  @ApiOperation({
    summary: 'Delete a tag',
    description: 'It is also removed from every contact that had it.',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('tagId') tagId: string,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.contacts.removeTag(workspace.workspaceId, tagId, {
      userId: auth.userId,
      context,
    });
  }
}

@ApiTags('contacts')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({
  description: 'Missing permission.',
  type: ErrorResponseDto,
})
@ApiNotFoundResponse({
  description: 'Not a member of the workspace, or CONTACT_FIELD_NOT_FOUND.',
  type: ErrorResponseDto,
})
@UseGuards(WorkspaceAccessGuard)
@Controller({ path: 'workspaces/:workspaceId/contact-fields', version: '1' })
export class ContactFieldsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions('contacts.read')
  @ApiOperation({ summary: 'Custom fields of the contacts' })
  @ApiOkResponse({ type: [ContactFieldDto] })
  list(
    @CurrentWorkspace() workspace: WorkspaceAccess,
  ): Promise<ContactFieldDto[]> {
    return this.contacts.listFields(workspace.workspaceId);
  }

  @Post()
  @RequirePermissions('contacts.manage')
  @ApiOperation({
    summary: 'Create a custom field',
    description:
      'Its key comes from the name (409 CONTACT_FIELD_TAKEN when another field has it). Up to 50 fields (409 CONTACT_FIELDS_LIMIT). SELECT needs options.',
  })
  @ApiCreatedResponse({ type: ContactFieldDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  create(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Body() dto: CreateContactFieldDto,
  ): Promise<ContactFieldDto> {
    return this.contacts.createField(workspace.workspaceId, dto);
  }

  @Patch(':fieldId')
  @RequirePermissions('contacts.manage')
  @ApiOperation({
    summary: 'Rename a custom field or change its options',
    description: 'The key and the type never change.',
  })
  @ApiOkResponse({ type: ContactFieldDto })
  update(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('fieldId') fieldId: string,
    @Body() dto: UpdateContactFieldDto,
  ): Promise<ContactFieldDto> {
    return this.contacts.updateField(workspace.workspaceId, fieldId, dto);
  }

  @Delete(':fieldId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('contacts.manage')
  @ApiOperation({
    summary: 'Delete a custom field',
    description: 'Its values are removed from every contact.',
  })
  @ApiNoContentResponse()
  async remove(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('fieldId') fieldId: string,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.contacts.removeField(workspace.workspaceId, fieldId, {
      userId: auth.userId,
      context,
    });
  }
}
