import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';

/** Stable `code`s so clients can show their own localized message. */
export const FunnelsErrors = {
  funnelNotFound: () =>
    new NotFoundException({
      message: 'Funnel not found',
      code: 'FUNNEL_NOT_FOUND',
    }),
  stageNotFound: () =>
    new NotFoundException({
      message: 'Stage not found',
      code: 'STAGE_NOT_FOUND',
    }),
  leadNotFound: () =>
    new NotFoundException({
      message: 'Lead not found',
      code: 'LEAD_NOT_FOUND',
    }),
  contactNotFound: () =>
    new NotFoundException({
      message: 'Contact not found',
      code: 'CONTACT_NOT_FOUND',
    }),
  lineNotFound: () =>
    new NotFoundException({
      message: 'Line not found',
      code: 'LINE_NOT_FOUND',
    }),
  lineDisabled: () =>
    new ConflictException({
      message: 'The line is turned off',
      code: 'LINE_DISABLED',
    }),
  nameTaken: () =>
    new ConflictException({
      message: 'The line already has a funnel with that name',
      code: 'FUNNEL_NAME_TAKEN',
    }),
  funnelHasLeads: (leads: number) =>
    new ConflictException({
      message: `The funnel has ${leads} leads`,
      code: 'FUNNEL_HAS_LEADS',
      details: { leads },
    }),
  stageHasLeads: (leads: number) =>
    new ConflictException({
      message: `Choose the stage that gets its ${leads} leads`,
      code: 'STAGE_HAS_LEADS',
      details: { leads },
    }),
  lastStage: () =>
    new ConflictException({
      message: 'A funnel keeps at least one stage',
      code: 'LAST_STAGE',
    }),
  stageLimit: (limit: number) =>
    new ConflictException({
      message: `A funnel has at most ${limit} stages`,
      code: 'STAGE_LIMIT',
      details: { limit },
    }),
  stageOrderInvalid: () =>
    new BadRequestException({
      message: 'Send every stage of the funnel once',
      code: 'STAGE_ORDER_INVALID',
    }),
  stageForbidden: () =>
    new ForbiddenException({
      message: 'You cannot see that stage of the funnel',
      code: 'STAGE_FORBIDDEN',
    }),
  leadExists: (details: { leadId: string; stageId: string }) =>
    new ConflictException({
      message: 'The contact is already in this funnel',
      code: 'LEAD_EXISTS',
      details,
    }),
  leadChanged: () =>
    new ConflictException({
      message: 'Someone else changed the lead; reload it and try again',
      code: 'LEAD_CHANGED',
    }),
  rulesInvalid: (problem: string) =>
    new BadRequestException({
      message: `Invalid rules: ${problem}`,
      code: 'FUNNEL_RULES_INVALID',
    }),
  membersInvalid: () =>
    new BadRequestException({
      message: 'Only active members and stages of this funnel',
      code: 'FUNNEL_PERMISSIONS_INVALID',
    }),
  filtersInvalid: (problem: string) =>
    new BadRequestException({
      message: `Invalid filters: ${problem}`,
      code: 'FUNNEL_FILTERS_INVALID',
    }),
  exportTooLarge: (limit: number) =>
    new PayloadTooLargeException({
      message: `Filter the board: an export has at most ${limit} leads`,
      code: 'EXPORT_TOO_LARGE',
      details: { limit },
    }),
  funnelNotOnLine: () =>
    new ConflictException({
      message: 'The funnel belongs to another line',
      code: 'FUNNEL_NOT_ON_LINE',
    }),
  featureNotInPlan: (details: { feature: string; plan: string }) =>
    new ForbiddenException({
      message: `The ${details.plan} plan does not include this feature`,
      code: 'FEATURE_NOT_IN_PLAN',
      details,
    }),
};
