import {
  ConflictException,
  ForbiddenException,
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
  agentFilterForbidden: () =>
    new ForbiddenException({
      message:
        'Filtering by agent requires conversations.view_all: you only see your own chats and the unassigned ones',
      code: 'AGENT_FILTER_FORBIDDEN',
    }),
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
  transferForbidden: () =>
    new ForbiddenException({
      message:
        'Only your own chats can be transferred, and only while «Transferencia de chats» is on; otherwise it needs conversations.assign',
      code: 'TRANSFER_FORBIDDEN',
    }),
  agentNotOnLine: () =>
    new ConflictException({
      message:
        'That agent does not attend the line of this conversation: assign them the line first',
      code: 'AGENT_NOT_ON_LINE',
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
  messageNotFound: () =>
    new NotFoundException({
      message: 'Message not found in this conversation',
      code: 'MESSAGE_NOT_FOUND',
    }),
  notRetryable: () =>
    new ConflictException({
      message: 'Only messages that were not delivered can be sent again',
      code: 'MESSAGE_NOT_RETRYABLE',
    }),
  mediaNotFound: () =>
    new NotFoundException({
      message: 'This message has no file',
      code: 'MEDIA_NOT_FOUND',
    }),
  mediaUnavailable: (reason: string) =>
    new HttpException(
      {
        message: `WhatsApp did not deliver the file: ${reason}`,
        code: 'MEDIA_UNAVAILABLE',
      },
      HttpStatus.BAD_GATEWAY,
    ),
  unsupportedMedia: () =>
    new HttpException(
      {
        message:
          'WhatsApp does not accept this kind of file: send JPG/PNG images, MP4 videos, AAC/MP3/MP4/OGG audio or PDF and Office documents',
        code: 'UNSUPPORTED_MEDIA_TYPE',
      },
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    ),
  mediaTooLarge: (maxBytes: number) =>
    new HttpException(
      {
        message: `The file is larger than WhatsApp allows for its type (${Math.round(maxBytes / 1024 / 1024)} MB)`,
        code: 'MEDIA_TOO_LARGE',
        details: { maxBytes },
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    ),
};
