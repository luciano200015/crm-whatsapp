import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { FlowIssue } from '../domain/flow';

/** Stable `code`s so clients can show their own localized message. */
export const ChatbotsErrors = {
  chatbotNotFound: () =>
    new NotFoundException({
      message: 'Chatbot not found',
      code: 'CHATBOT_NOT_FOUND',
    }),
  flowInvalid: (issues: FlowIssue[]) =>
    new BadRequestException({
      message: 'The chatbot flow is not valid',
      code: 'FLOW_INVALID',
      details: { issues: issues.slice(0, 50) },
    }),
  flowIncomplete: (issues: FlowIssue[]) =>
    new ConflictException({
      message: 'Complete the flow before turning the chatbot on',
      code: 'FLOW_INCOMPLETE',
      details: { issues: issues.slice(0, 50) },
    }),
  scheduleInvalid: (problem: string) =>
    new BadRequestException({
      message: `Invalid schedule: ${problem}`,
      code: 'SCHEDULE_INVALID',
    }),
  lineNotFound: () =>
    new NotFoundException({
      message: 'Line not found',
      code: 'LINE_NOT_FOUND',
    }),
  lineHasChatbot: (details: {
    lineId: string;
    lineName: string;
    chatbot: string;
  }) =>
    new ConflictException({
      message: `The line ${details.lineName} already answers with the chatbot ${details.chatbot}`,
      code: 'LINE_HAS_CHATBOT',
      details,
    }),
  featureNotInPlan: (details: { feature: string; plan: string }) =>
    new ForbiddenException({
      message: `The ${details.plan} plan does not include this feature`,
      code: 'FEATURE_NOT_IN_PLAN',
      details,
    }),
  mediaNotFound: () =>
    new NotFoundException({
      message: 'File not found',
      code: 'MEDIA_NOT_FOUND',
    }),
};
