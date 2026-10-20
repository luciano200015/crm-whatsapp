import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/** Stable `code`s so clients can show their own localized message. */
export const ChannelsErrors = {
  lineNotFound: () =>
    new NotFoundException({
      message: 'Line not found',
      code: 'LINE_NOT_FOUND',
    }),
  phoneNumberIdTaken: () =>
    new ConflictException({
      message: 'This WhatsApp phone number is already connected to a line',
      code: 'PHONE_NUMBER_ID_TAKEN',
    }),
  lineLimitReached: (details: { plan: string; limit: number; usage: number }) =>
    new ConflictException({
      message: `The ${details.plan} plan allows ${details.limit} WhatsApp lines and the workspace already has ${details.usage}`,
      code: 'LINE_LIMIT_REACHED',
      details: { feature: 'limits.whatsapp_lines', ...details },
    }),
  subscriptionInactive: () =>
    new HttpException(
      {
        message: 'The workspace plan is not active: choose a plan to continue',
        code: 'SUBSCRIPTION_INACTIVE',
      },
      HttpStatus.PAYMENT_REQUIRED,
    ),
  memberNotFound: () =>
    new NotFoundException({
      message: 'Only active members of the workspace can attend a line',
      code: 'MEMBER_NOT_FOUND',
    }),
  verificationFailed: () =>
    new ForbiddenException({
      message: 'Webhook verification failed',
      code: 'WEBHOOK_VERIFICATION_FAILED',
    }),
  invalidSignature: () =>
    new UnauthorizedException({
      message: 'Invalid webhook signature',
      code: 'INVALID_SIGNATURE',
    }),
};
