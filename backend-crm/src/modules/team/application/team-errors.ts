import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

/**
 * Team errors carry a stable `code` (and `details`) in the response body so
 * clients can show their own localized message.
 */
export const TeamErrors = {
  memberNotFound: () =>
    new NotFoundException({
      message: 'Member not found',
      code: 'MEMBER_NOT_FOUND',
    }),
  roleNotFound: () =>
    new NotFoundException({
      message: 'Role not found',
      code: 'ROLE_NOT_FOUND',
    }),
  memberAlreadyExists: () =>
    new ConflictException({
      message: 'This person is already a member of the workspace',
      code: 'MEMBER_ALREADY_EXISTS',
    }),
  memberDeactivated: () =>
    new ConflictException({
      message: 'This person is a deactivated member: reactivate them instead',
      code: 'MEMBER_DEACTIVATED',
    }),
  cannotModifySelf: () =>
    new ForbiddenException({
      message: 'You cannot change your own role or deactivate yourself',
      code: 'CANNOT_MODIFY_SELF',
    }),
  lastOwner: () =>
    new ConflictException({
      message: 'The workspace must keep at least one active owner',
      code: 'LAST_OWNER',
    }),
  escalation: (missing: string[]) =>
    new ForbiddenException({
      message: 'You cannot grant or manage permissions you do not have',
      code: 'ROLE_ESCALATION',
      details: { missing },
    }),
  systemRoleReadOnly: () =>
    new ForbiddenException({
      message: 'System roles cannot be changed or deleted',
      code: 'SYSTEM_ROLE_READ_ONLY',
    }),
  roleNameTaken: () =>
    new ConflictException({
      message: 'A role with this name already exists',
      code: 'ROLE_NAME_TAKEN',
    }),
  roleInUse: (members: number) =>
    new ConflictException({
      message: `This role is assigned to ${members} member(s): assign them another role first`,
      code: 'ROLE_IN_USE',
      details: { members },
    }),
  accessAlreadySet: () =>
    new ConflictException({
      message:
        'This member already chose a password: they can use "Forgot password"',
      code: 'ACCESS_ALREADY_SET',
    }),
  memberInactive: () =>
    new ConflictException({
      message: 'This member is deactivated',
      code: 'MEMBER_INACTIVE',
    }),
  agentLimitReached: (details: {
    plan: string;
    limit: number;
    usage: number;
  }) =>
    new ConflictException({
      message: `The ${details.plan} plan allows ${details.limit} active agents and the workspace already has ${details.usage}`,
      code: 'AGENT_LIMIT_REACHED',
      details: { feature: 'limits.agents', ...details },
    }),
  featureNotInPlan: (details: { feature: string; plan: string }) =>
    new ForbiddenException({
      message: `The ${details.plan} plan does not include this feature`,
      code: 'FEATURE_NOT_IN_PLAN',
      details,
    }),
  subscriptionInactive: () =>
    new HttpException(
      {
        message: 'The workspace plan is not active: choose a plan to continue',
        code: 'SUBSCRIPTION_INACTIVE',
      },
      HttpStatus.PAYMENT_REQUIRED,
    ),
};
