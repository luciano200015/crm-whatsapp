import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

/**
 * Billing errors carry a stable `code` (and `details`) in the response body
 * so clients can show their own localized message.
 */
export const BillingErrors = {
  planUnavailable: () =>
    new BadRequestException({
      message: 'This plan is not available',
      code: 'PLAN_UNAVAILABLE',
    }),
  noSubscription: () =>
    new NotFoundException({
      message: 'This workspace has no plan yet',
      code: 'NO_SUBSCRIPTION',
    }),
  alreadyOnPlan: () =>
    new ConflictException({
      message: 'The workspace is already on this plan',
      code: 'ALREADY_ON_PLAN',
    }),
  alreadyActive: () =>
    new ConflictException({
      message: 'The plan is already active',
      code: 'ALREADY_ACTIVE',
    }),
  nothingToCancel: () =>
    new ConflictException({
      message: 'There is nothing to cancel',
      code: 'NOTHING_TO_CANCEL',
    }),
  noPendingCancellation: () =>
    new ConflictException({
      message: 'There is no pending cancellation',
      code: 'NO_PENDING_CANCELLATION',
    }),
  limitExceeded: (details: {
    feature: string;
    plan: string;
    limit: number;
    usage: number;
  }) =>
    new ConflictException({
      message: `The ${details.plan} plan allows ${details.limit} agents and this workspace has ${details.usage} active members. Deactivate members first.`,
      code: 'PLAN_LIMIT_EXCEEDED',
      details,
    }),
  paymentsUnavailable: () =>
    new HttpException(
      {
        message: 'Online payments are not available yet',
        code: 'PAYMENTS_UNAVAILABLE',
      },
      HttpStatus.PAYMENT_REQUIRED,
    ),
};
