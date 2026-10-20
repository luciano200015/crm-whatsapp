import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
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
import { CurrentUser, Public } from '../../auth/presentation/auth.decorators';
import type { WorkspaceAccess } from '../../authorization/application/authorization.service';
import {
  CurrentWorkspace,
  RequirePermissions,
} from '../../authorization/presentation/workspace-access.decorators';
import { WorkspaceAccessGuard } from '../../authorization/presentation/workspace-access.guard';
import { BillingService } from '../application/billing.service';
import { CatalogDto, ChangePlanDto, SubscriptionDto } from './billing.dto';

@ApiTags('billing')
@Controller({ path: 'billing', version: '1' })
export class BillingCatalogController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get('plans')
  @ApiOperation({
    summary: 'Public plan catalog (pricing page)',
    description:
      'Plans with monthly and yearly prices, the feature catalog and each plan’s limits and inclusions. Also returns the trial length and the default sign-up plan.',
  })
  @ApiOkResponse({ type: CatalogDto })
  catalog(): Promise<CatalogDto> {
    return this.billing.catalog();
  }
}

@ApiTags('billing')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({
  description: 'Not a member of this workspace, or it has no plan.',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description: 'Missing billing permission (billing.read / billing.manage).',
  type: ErrorResponseDto,
})
@UseGuards(WorkspaceAccessGuard)
@Controller({ path: 'workspaces/:workspaceId/subscription', version: '1' })
export class WorkspaceSubscriptionController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermissions('billing.read')
  @ApiOperation({
    summary: 'Current plan, status, trial, limits and usage',
    description: 'Requires billing.read (OWNER, ADMIN).',
  })
  @ApiOkResponse({ type: SubscriptionDto })
  get(
    @CurrentWorkspace() workspace: WorkspaceAccess,
  ): Promise<SubscriptionDto> {
    return this.billing.getSubscription(workspace.workspaceId);
  }

  @Put('plan')
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Change plan or billing interval (upgrade / downgrade)',
    description:
      'Requires billing.manage (OWNER). During a trial the plan changes and the trial continues. Otherwise the new plan is charged and a new period starts (402 while payments are disabled). Downgrades that do not fit current usage answer 409.',
  })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiBadRequestResponse({
    description: 'Unknown or unavailable plan.',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Already on that plan, or usage exceeds the new limits.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.PAYMENT_REQUIRED,
    description: 'Payments are not available yet.',
    type: ErrorResponseDto,
  })
  changePlan(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Body() dto: ChangePlanDto,
    @ReqContext() context: RequestContext,
  ): Promise<SubscriptionDto> {
    return this.billing.changePlan(workspace.workspaceId, dto, {
      userId: auth.userId,
      context,
    });
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Pay for the current plan',
    description:
      'Ends a trial early or reactivates an expired/past-due/canceled plan. With BILLING_PAYMENTS_MODE=simulated the payment succeeds instantly.',
  })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiConflictResponse({
    description: 'Already active.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.PAYMENT_REQUIRED,
    description: 'Payments are not available yet.',
    type: ErrorResponseDto,
  })
  activate(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
  ): Promise<SubscriptionDto> {
    return this.billing.activate(workspace.workspaceId, {
      userId: auth.userId,
      context,
    });
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('billing.manage')
  @ApiOperation({
    summary: 'Cancel the plan',
    description:
      'A trial ends immediately. A paid plan stays usable until the end of the current period.',
  })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiConflictResponse({
    description: 'Nothing to cancel.',
    type: ErrorResponseDto,
  })
  cancel(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
  ): Promise<SubscriptionDto> {
    return this.billing.cancel(workspace.workspaceId, {
      userId: auth.userId,
      context,
    });
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('billing.manage')
  @ApiOperation({ summary: 'Undo a pending cancellation' })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiConflictResponse({
    description: 'No pending cancellation.',
    type: ErrorResponseDto,
  })
  resume(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
  ): Promise<SubscriptionDto> {
    return this.billing.resume(workspace.workspaceId, {
      userId: auth.userId,
      context,
    });
  }
}
