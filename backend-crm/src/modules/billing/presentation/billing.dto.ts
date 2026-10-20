import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, Matches } from 'class-validator';

const INTERVALS = ['MONTH', 'YEAR'] as const;
const FEATURE_KINDS = ['LIMIT', 'BOOLEAN', 'TEXT'] as const;
const STATUSES = [
  'TRIALING',
  'ACTIVE',
  'INCOMPLETE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
] as const;

const FEATURE_VALUE_SCHEMA = {
  nullable: true,
  oneOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }],
  description:
    'LIMIT: number (null = unlimited). BOOLEAN: included or not. TEXT: description or null.',
};

// ─────────────────────────── Requests ───────────────────────────

export class ChangePlanDto {
  @ApiProperty({
    example: 'business',
    description: 'Plan code from GET /billing/plans.',
  })
  @Matches(/^[a-z][a-z0-9_-]{1,49}$/, {
    message: 'planCode has an invalid format',
  })
  planCode: string;

  @ApiProperty({ enum: INTERVALS, example: 'YEAR' })
  @IsIn(INTERVALS)
  interval: (typeof INTERVALS)[number];
}

// ─────────────────────────── Responses ───────────────────────────

export class CatalogFeatureDto {
  @ApiProperty({ example: 'limits.agents' })
  key: string;

  @ApiProperty({ example: 'Agentes (usuarios)' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ enum: FEATURE_KINDS })
  kind: string;

  @ApiProperty({ nullable: true, type: String, example: 'agentes' })
  unit: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'limits' })
  group: string | null;
}

export class PlanPriceDto {
  @ApiProperty({ enum: INTERVALS })
  interval: string;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 22900, description: 'Minor units (cents).' })
  amountCents: number;

  @ApiProperty({
    example: 19083,
    description: 'Yearly price / 12, or the monthly price.',
  })
  monthlyEquivalentCents: number;
}

export class PlanFeatureValueDto {
  @ApiProperty({ example: 'limits.agents' })
  key: string;

  @ApiProperty(FEATURE_VALUE_SCHEMA)
  value: number | boolean | string | null;
}

export class PlanDto {
  @ApiProperty({ example: 'business' })
  code: string;

  @ApiProperty({ example: 'Empresa' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  tagline: string | null;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty()
  highlighted: boolean;

  @ApiProperty({ type: [PlanPriceDto] })
  prices: PlanPriceDto[];

  @ApiProperty({ example: 17 })
  yearlySavingsPercent: number;

  @ApiProperty({ type: [PlanFeatureValueDto] })
  features: PlanFeatureValueDto[];
}

export class CatalogDto {
  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    example: 7,
    description: 'Free trial for new sign-ups (0 = none).',
  })
  trialDays: number;

  @ApiProperty({
    example: 'team',
    description: 'Plan given at sign-up by default.',
  })
  defaultPlan: string;

  @ApiProperty({ description: 'False until a payment provider is configured.' })
  paymentsEnabled: boolean;

  @ApiProperty({ type: [CatalogFeatureDto] })
  features: CatalogFeatureDto[];

  @ApiProperty({ type: [PlanDto] })
  plans: PlanDto[];
}

export class EntitlementDto {
  @ApiProperty({ example: 'limits.agents' })
  key: string;

  @ApiProperty({ example: 'Agentes (usuarios)' })
  name: string;

  @ApiProperty({ enum: FEATURE_KINDS })
  kind: string;

  @ApiProperty({ nullable: true, type: String })
  unit: string | null;

  @ApiProperty(FEATURE_VALUE_SCHEMA)
  value: number | boolean | string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Current usage when measured.',
  })
  usage: number | null;
}

export class SubscriptionPlanDto {
  @ApiProperty({ example: 'team' })
  code: string;

  @ApiProperty({ example: 'Equipo' })
  name: string;
}

export class SubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  workspaceId: string;

  @ApiProperty({ type: SubscriptionPlanDto })
  plan: SubscriptionPlanDto;

  @ApiProperty({ enum: INTERVALS })
  interval: string;

  @ApiProperty({ example: 9900 })
  amountCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    enum: STATUSES,
    description:
      'Effective status (an expired trial is EXPIRED even before any job runs).',
  })
  status: string;

  @ApiProperty({ description: 'True while TRIALING or ACTIVE.' })
  hasFullAccess: boolean;

  @ApiPropertyOptional({ nullable: true, type: Date })
  trialEndsAt: Date | null;

  @ApiProperty({ example: 6 })
  trialDaysLeft: number;

  @ApiPropertyOptional({ nullable: true, type: Date })
  currentPeriodStart: Date | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  currentPeriodEnd: Date | null;

  @ApiProperty()
  cancelAtPeriodEnd: boolean;

  @ApiPropertyOptional({ nullable: true, type: Date })
  canceledAt: Date | null;

  @ApiProperty()
  paymentsEnabled: boolean;

  @ApiProperty({ type: [EntitlementDto] })
  entitlements: EntitlementDto[];
}
