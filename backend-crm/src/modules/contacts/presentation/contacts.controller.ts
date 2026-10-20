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
  ContactDto,
  ContactPageDto,
  CreateContactDto,
  CreateTagDto,
  ListContactsQueryDto,
  SetContactTagsDto,
  TagDto,
  UpdateContactDto,
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
