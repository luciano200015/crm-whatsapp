import {
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

/** Stable `code`s so clients can show their own localized message. */
export const InboxErrors = {
  // Same status as team and channels: the plan must be paid or in trial.
  subscriptionInactive: () =>
    new HttpException(
      {
        message: 'An active subscription or trial is required to send messages',
        code: 'SUBSCRIPTION_INACTIVE',
      },
      HttpStatus.PAYMENT_REQUIRED,
    ),
  conversationNotFound: () =>
    new NotFoundException({
      message: 'Conversation not found',
      code: 'CONVERSATION_NOT_FOUND',
    }),
  conversationClosed: () =>
    new ConflictException({
      message: 'The conversation is closed: reopen it to reply',
      code: 'CONVERSATION_CLOSED',
    }),
  alreadyOpen: () =>
    new ConflictException({
      message: 'This contact already has an open conversation on this line',
      code: 'CONVERSATION_ALREADY_OPEN',
    }),
  windowClosed: () =>
    new ConflictException({
      message:
        'More than 24 hours passed since the customer last wrote: WhatsApp only allows template messages',
      code: 'WINDOW_CLOSED',
    }),
  lineUnavailable: () =>
    new ConflictException({
      message: 'The line of this conversation was deleted or is disabled',
      code: 'LINE_UNAVAILABLE',
    }),
  alreadyAssigned: () =>
    new ConflictException({
      message: 'Another agent already took this conversation',
      code: 'ALREADY_ASSIGNED',
    }),
  memberNotFound: () =>
    new NotFoundException({
      message: 'Only active members of the workspace can be assigned',
      code: 'MEMBER_NOT_FOUND',
    }),
  contactLimitReached: (details: {
    plan: string;
    limit: number;
    usage: number;
  }) =>
    new ConflictException({
      message: `The ${details.plan} plan allows ${details.limit} active contacts per month and the workspace already reached it`,
      code: 'CONTACT_LIMIT_REACHED',
      details: { feature: 'limits.active_contacts', ...details },
    }),
};
