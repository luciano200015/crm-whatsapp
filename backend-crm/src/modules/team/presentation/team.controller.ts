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
  ApiResponse,
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
import { MembersService } from '../application/members.service';
import { RolesService } from '../application/roles.service';
import type { TeamActor } from '../application/team-access';
import {
  ChangeMemberRoleDto,
  CreateMemberDto,
  CreateRoleDto,
  ListMembersQueryDto,
  MemberDto,
  MemberListDto,
  PermissionDto,
  RoleDto,
  UpdateRoleDto,
} from './team.dto';

/** Malformed ids are reported like missing ones. */
const ID = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

const actor = (
  auth: AuthContext,
  access: WorkspaceAccess,
  context: RequestContext,
): TeamActor => ({ userId: auth.userId, access, context });

@ApiTags('team')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({
  description: 'Not a member of the workspace, or unknown member.',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description:
    'Missing permission, ROLE_ESCALATION (you cannot grant or manage permissions you do not hold), CANNOT_MODIFY_SELF or FEATURE_NOT_IN_PLAN.',
  type: ErrorResponseDto,
})
@UseGuards(WorkspaceAccessGuard)
@Controller({ path: 'workspaces/:workspaceId/members', version: '1' })
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermissions('members.read')
  @ApiOperation({
    summary: 'List the members (agents) of the workspace',
    description:
      'Includes deactivated members and the plan usage (active members against limits.agents).',
  })
  @ApiOkResponse({ type: MemberListDto })
  list(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Query() query: ListMembersQueryDto,
  ): Promise<MemberListDto> {
    return this.members.list(workspace.workspaceId, query);
  }

  @Get(':memberId')
  @RequirePermissions('members.read')
  @ApiOperation({ summary: 'One member' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: MemberDto })
  get(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('memberId', ID) memberId: string,
  ): Promise<MemberDto> {
    return this.members.get(workspace.workspaceId, memberId);
  }

  @Post()
  @RequirePermissions('members.invite')
  @ApiOperation({
    summary: 'Register a new agent',
    description:
      'New email: creates the account with a random temporary password, emails it (see Mailpit in development) and the user must change it on first sign-in. ' +
      'Existing account: adds the membership and sends a notice; the password is not touched. ' +
      'Requires an active plan (402 SUBSCRIPTION_INACTIVE), room in limits.agents (409 AGENT_LIMIT_REACHED) and, for custom roles, a plan that includes them.',
  })
  @ApiCreatedResponse({ type: MemberDto })
  @ApiConflictResponse({
    description:
      'MEMBER_ALREADY_EXISTS, MEMBER_DEACTIVATED or AGENT_LIMIT_REACHED.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.PAYMENT_REQUIRED,
    description:
      'SUBSCRIPTION_INACTIVE: the trial ended or the plan is not paid.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Body() dto: CreateMemberDto,
    @ReqContext() context: RequestContext,
  ): Promise<MemberDto> {
    return this.members.create(actor(auth, workspace, context), dto);
  }

  @Patch(':memberId')
  @RequirePermissions('members.manage')
  @ApiOperation({
    summary: "Change a member's role",
    description:
      'Not your own role, and only for members whose permissions you hold. The workspace always keeps an active OWNER (409 LAST_OWNER).',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: MemberDto })
  @ApiConflictResponse({ description: 'LAST_OWNER.', type: ErrorResponseDto })
  changeRole(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('memberId', ID) memberId: string,
    @Body() dto: ChangeMemberRoleDto,
    @ReqContext() context: RequestContext,
  ): Promise<MemberDto> {
    return this.members.changeRole(
      actor(auth, workspace, context),
      memberId,
      dto.roleId,
    );
  }

  @Post(':memberId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('members.manage')
  @ApiOperation({
    summary: 'Deactivate a member',
    description:
      'Access to this workspace ends on their next request. Their account and other workspaces are not affected.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: MemberDto })
  @ApiConflictResponse({ description: 'LAST_OWNER.', type: ErrorResponseDto })
  deactivate(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('memberId', ID) memberId: string,
    @ReqContext() context: RequestContext,
  ): Promise<MemberDto> {
    return this.members.deactivate(actor(auth, workspace, context), memberId);
  }

  @Post(':memberId/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('members.manage')
  @ApiOperation({
    summary: 'Reactivate a member',
    description: 'Counts against limits.agents and needs an active plan.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiOkResponse({ type: MemberDto })
  @ApiConflictResponse({
    description: 'AGENT_LIMIT_REACHED.',
    type: ErrorResponseDto,
  })
  reactivate(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('memberId', ID) memberId: string,
    @ReqContext() context: RequestContext,
  ): Promise<MemberDto> {
    return this.members.reactivate(actor(auth, workspace, context), memberId);
  }

  @Post(':memberId/resend-access')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('members.invite')
  @ApiOperation({
    summary: 'Email a new temporary password',
    description:
      'Only while the member has not chosen their own password (409 ACCESS_ALREADY_SET); afterwards they use "Forgot password".',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiConflictResponse({
    description: 'ACCESS_ALREADY_SET or MEMBER_INACTIVE.',
    type: ErrorResponseDto,
  })
  async resendAccess(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('memberId', ID) memberId: string,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.members.resendAccess(actor(auth, workspace, context), memberId);
  }
}

@ApiTags('team')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({
  description: 'Not a member of the workspace, or unknown role.',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description:
    'Missing permission, SYSTEM_ROLE_READ_ONLY, ROLE_ESCALATION or FEATURE_NOT_IN_PLAN (custom roles need the Empresa or Corporativo plan).',
  type: ErrorResponseDto,
})
@UseGuards(WorkspaceAccessGuard)
@Controller({ path: 'workspaces/:workspaceId', version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Permission catalog, grouped by module (to build custom roles)',
  })
  @ApiOkResponse({ type: [PermissionDto] })
  permissions(): PermissionDto[] {
    return this.roles.permissions();
  }

  @Get('roles')
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'System roles and the custom roles of this workspace',
    description:
      'System roles (OWNER, ADMIN, AGENT) have system=true: shared by every workspace and read-only. Custom roles belong only to this workspace.',
  })
  @ApiOkResponse({ type: [RoleDto] })
  list(@CurrentWorkspace() workspace: WorkspaceAccess): Promise<RoleDto[]> {
    return this.roles.list(workspace.workspaceId);
  }

  @Get('roles/:roleId')
  @RequirePermissions('roles.read')
  @ApiOperation({ summary: 'One role with its permissions' })
  @ApiParam({ name: 'roleId', format: 'uuid' })
  @ApiOkResponse({ type: RoleDto })
  get(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('roleId', ID) roleId: string,
  ): Promise<RoleDto> {
    return this.roles.get(workspace.workspaceId, roleId);
  }

  @Post('roles')
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Create a custom role from existing permissions',
    description:
      'Needs a plan with custom roles. The name is unique in the workspace (409 ROLE_NAME_TAKEN).',
  })
  @ApiCreatedResponse({ type: RoleDto })
  @ApiConflictResponse({
    description: 'ROLE_NAME_TAKEN.',
    type: ErrorResponseDto,
  })
  create(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Body() dto: CreateRoleDto,
    @ReqContext() context: RequestContext,
  ): Promise<RoleDto> {
    return this.roles.create(actor(auth, workspace, context), dto);
  }

  @Patch('roles/:roleId')
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Edit a custom role',
    description: 'Changes apply at once to every member with the role.',
  })
  @ApiParam({ name: 'roleId', format: 'uuid' })
  @ApiOkResponse({ type: RoleDto })
  @ApiConflictResponse({
    description: 'ROLE_NAME_TAKEN.',
    type: ErrorResponseDto,
  })
  update(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('roleId', ID) roleId: string,
    @Body() dto: UpdateRoleDto,
    @ReqContext() context: RequestContext,
  ): Promise<RoleDto> {
    return this.roles.update(actor(auth, workspace, context), roleId, dto);
  }

  @Delete('roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('roles.manage')
  @ApiOperation({
    summary: 'Delete a custom role',
    description:
      'Refused while members have it (409 ROLE_IN_USE): assign them another role first.',
  })
  @ApiParam({ name: 'roleId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiConflictResponse({ description: 'ROLE_IN_USE.', type: ErrorResponseDto })
  async remove(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Param('roleId', ID) roleId: string,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.roles.remove(actor(auth, workspace, context), roleId);
  }
}
