import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CHAT_STATUSES, FUNNEL_LIMITS } from '../domain/funnel-rules';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `?ids=a,b` or `?ids=a&ids=b` → ['a', 'b']. */
const list = ({ value }: { value: unknown }): unknown => {
  const items: unknown[] = Array.isArray(value)
    ? (value as unknown[])
    : [value];
  return items
    .flatMap((item): unknown[] =>
      typeof item === 'string' ? item.split(',') : [item],
    )
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '');
};

/** `?archived=true` → true. */
const flag = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : value;

const SORTS = ['recent', 'value_desc', 'value_asc'] as const;
const BULK_ACTIONS = ['move', 'archive', 'restore', 'remove'] as const;

// ─────────────────────────── Requests ───────────────────────────

export class CreateFunnelDto {
  @ApiProperty({ format: 'uuid', description: 'WhatsApp line of the funnel.' })
  @IsUUID()
  lineId: string;

  @ApiProperty({ example: 'Seguimiento ventas', maxLength: FUNNEL_LIMITS.name })
  @Transform(trim)
  @IsString()
  @Length(1, FUNNEL_LIMITS.name)
  name: string;

  @ApiPropertyOptional({ maxLength: FUNNEL_LIMITS.description })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(FUNNEL_LIMITS.description)
  description?: string;

  @ApiPropertyOptional({
    description:
      '"Embudo principal": new conversations of the line join its first stage. The previous primary funnel of the line stops being it.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({
    description:
      'Creates the stages Nuevo, En atención, Esperando cliente and Cerrado.',
  })
  @IsOptional()
  @IsBoolean()
  defaultStages?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: FUNNEL_LIMITS.archiveAfterDays,
    description:
      'Archives leads without messages for this many days (null: never). A new message of the customer restores them.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(FUNNEL_LIMITS.archiveAfterDays)
  archiveAfterDays?: number | null;
}

export class UpdateFunnelDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only while it has no leads (409 FUNNEL_HAS_LEADS).',
  })
  @IsOptional()
  @IsUUID()
  lineId?: string;

  @ApiPropertyOptional({ maxLength: FUNNEL_LIMITS.name })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, FUNNEL_LIMITS.name)
  name?: string;

  @ApiPropertyOptional({ maxLength: FUNNEL_LIMITS.description })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(FUNNEL_LIMITS.description)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: FUNNEL_LIMITS.archiveAfterDays,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(FUNNEL_LIMITS.archiveAfterDays)
  archiveAfterDays?: number | null;
}

export class DeleteFunnelQueryDto {
  @ApiPropertyOptional({
    description: 'Required when the funnel has leads (409 FUNNEL_HAS_LEADS).',
  })
  @IsOptional()
  @Transform(flag)
  @IsBoolean()
  confirm?: boolean;
}

export class StageNameDto {
  @ApiProperty({
    example: 'Cotización enviada',
    maxLength: FUNNEL_LIMITS.stageName,
  })
  @Transform(trim)
  @IsString()
  @Length(1, FUNNEL_LIMITS.stageName)
  name: string;
}

export class StageOrderDto {
  @ApiProperty({
    type: [String],
    description: 'Every stage of the funnel, in its new order.',
  })
  @IsArray()
  @ArrayMaxSize(FUNNEL_LIMITS.stages)
  @IsUUID('all', { each: true })
  stageIds: string[];
}

export class DeleteStageQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Stage that receives its leads; required when it has leads (409 STAGE_HAS_LEADS).',
  })
  @IsOptional()
  @IsUUID()
  moveTo?: string;
}

export class BoardQueryDto {
  @ApiPropertyOptional({ description: 'Part of the contact name or phone.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Chats assigned to any of these membership ids (comma separated).',
  })
  @IsOptional()
  @Transform(list)
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  agentIds?: string[];

  @ApiPropertyOptional({
    description: 'Leads whose chat has no agent (OR with agentIds).',
  })
  @IsOptional()
  @Transform(flag)
  @IsBoolean()
  unassigned?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Contacts with any of these tags (comma separated).',
  })
  @IsOptional()
  @Transform(list)
  @IsArray()
  @ArrayMaxSize(20)
  @IsMongoId({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({ type: [String], enum: CHAT_STATUSES })
  @IsOptional()
  @Transform(list)
  @IsArray()
  @IsIn(CHAT_STATUSES, { each: true })
  statuses?: (typeof CHAT_STATUSES)[number][];

  @ApiPropertyOptional({
    description: 'Only archived leads, in the stage they were in.',
  })
  @IsOptional()
  @Transform(flag)
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional({ minimum: 0, description: 'Minimum value, in cents.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(FUNNEL_LIMITS.amountCents)
  minCents?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Maximum value, in cents.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(FUNNEL_LIMITS.amountCents)
  maxCents?: number;

  @ApiPropertyOptional({ enum: SORTS, default: 'recent' })
  @IsOptional()
  @IsIn(SORTS)
  sort?: (typeof SORTS)[number];
}

export class StageLeadsQueryDto extends BoardQueryDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  offset?: number;
}

export class AddLeadDto {
  @ApiProperty({ description: 'An existing contact.' })
  @IsMongoId()
  contactId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stageId: string;
}

export class MoveLeadDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stageId: string;

  @ApiPropertyOptional({
    description:
      '`version` of the lead as read; an older one gives 409 LEAD_CHANGED.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class LeadAmountDto {
  @ApiProperty({ minimum: 0, description: 'Value in cents ("Valor").' })
  @IsInt()
  @Min(0)
  @Max(FUNNEL_LIMITS.amountCents)
  amountCents: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class ArchiveLeadDto {
  @ApiProperty({ description: 'true: archive; false: restore.' })
  @IsBoolean()
  archived: boolean;
}

export class BulkLeadsDto {
  @ApiProperty({ enum: BULK_ACTIONS })
  @IsIn(BULK_ACTIONS)
  action: (typeof BULK_ACTIONS)[number];

  @ApiPropertyOptional({ type: [String], description: '"Seleccionar leads".' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true })
  leadIds?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: '"Seleccionar toda la etapa": every lead of this stage.',
  })
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @ApiPropertyOptional({
    description: 'With stageId: the archived leads of the stage instead.',
  })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'Target of `move`.' })
  @IsOptional()
  @IsUUID()
  moveTo?: string;
}

export class SetContactStageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  funnelId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stageId: string;
}

export class MemberStagesDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  membershipId: string;

  @ApiProperty({
    type: [String],
    description: 'Stages the member sees; empty: every stage.',
  })
  @IsArray()
  @ArrayMaxSize(FUNNEL_LIMITS.stages)
  @IsUUID('all', { each: true })
  stageIds: string[];
}

export class FunnelPermissionsDto {
  @ApiProperty({ type: [MemberStagesDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MemberStagesDto)
  members: MemberStagesDto[];
}

export class SyncRuleDto {
  @ApiProperty({ enum: CHAT_STATUSES, description: 'Chat status (origin).' })
  @IsIn(CHAT_STATUSES)
  status: (typeof CHAT_STATUSES)[number];

  @ApiProperty({ format: 'uuid', description: 'Stage (destination).' })
  @IsUUID()
  stageId: string;
}

export class SyncFunnelDto {
  @ApiProperty({ type: [SyncRuleDto] })
  @IsArray()
  @ArrayMaxSize(CHAT_STATUSES.length)
  @ValidateNested({ each: true })
  @Type(() => SyncRuleDto)
  rules: SyncRuleDto[];
}

export class BoardPreferencesDto {
  @ApiProperty({ description: '"Mostrar valor del lead".' })
  @IsBoolean()
  showValue: boolean;

  @ApiProperty({ description: '"Mostrar agente asignado".' })
  @IsBoolean()
  showAgent: boolean;
}

export class AutomationQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  lineId: string;
}

export class AutomationRuleDto {
  @ApiProperty({ enum: CHAT_STATUSES })
  @IsIn(CHAT_STATUSES)
  status: (typeof CHAT_STATUSES)[number];

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  funnelId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stageId: string;
}

export class AutomationRulesDto {
  @ApiProperty({ type: [AutomationRuleDto] })
  @IsArray()
  @ArrayMaxSize(CHAT_STATUSES.length)
  @ValidateNested({ each: true })
  @Type(() => AutomationRuleDto)
  rules: AutomationRuleDto[];
}

// ─────────────────────────── Responses ───────────────────────────

export class StageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  position: number;
}

export class FunnelSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ format: 'uuid' })
  lineId: string;

  @ApiProperty()
  lineName: string;

  @ApiProperty()
  isPrimary: boolean;

  @ApiProperty({ type: Number, nullable: true })
  archiveAfterDays: number | null;

  @ApiProperty({ description: 'Active (not archived) leads.' })
  leads: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class FunnelDto extends FunnelSummaryDto {
  @ApiProperty({
    type: [StageDto],
    description: 'Stages you see, in board order.',
  })
  stages: StageDto[];

  @ApiProperty({ type: [SyncRuleDto], description: 'Last sync rules.' })
  syncRules: SyncRuleDto[];
}

export class LeadContactDto {
  @ApiProperty({ type: String, nullable: true })
  name: string | null;

  @ApiProperty()
  phone: string;

  @ApiProperty({ type: [String] })
  tagIds: string[];
}

export class LeadLastMessageDto {
  @ApiProperty({ type: String, nullable: true })
  text: string | null;

  @ApiProperty()
  type: string;

  @ApiProperty()
  direction: string;

  @ApiProperty()
  at: Date;
}

export class LeadAgentDto {
  @ApiProperty({ format: 'uuid' })
  membershipId: string;

  @ApiProperty()
  name: string;
}

export class LeadConversationDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: CHAT_STATUSES })
  status: string;

  @ApiProperty({ type: LeadAgentDto, nullable: true })
  assignee: LeadAgentDto | null;

  @ApiProperty({
    description:
      'False for a chat of another agent: no preview, and it does not open.',
  })
  visible: boolean;

  @ApiProperty({ type: LeadLastMessageDto, nullable: true })
  lastMessage: LeadLastMessageDto | null;

  @ApiProperty()
  unreadCount: number;
}

export class ArchivedByDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;
}

export class LeadDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ format: 'uuid' })
  funnelId: string;

  @ApiProperty({ format: 'uuid' })
  stageId: string;

  @ApiProperty()
  contactId: string;

  @ApiProperty({ description: 'Value in cents.' })
  amountCents: number;

  @ApiProperty({ type: Date, nullable: true })
  archivedAt: Date | null;

  @ApiProperty({
    type: ArchivedByDto,
    nullable: true,
    description: 'null with archivedAt: archived for inactivity.',
  })
  archivedBy: ArchivedByDto | null;

  @ApiProperty()
  activityAt: Date;

  @ApiProperty({ description: 'Send it back to move or change the value.' })
  version: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: LeadContactDto, nullable: true })
  contact: LeadContactDto | null;

  @ApiProperty({ type: LeadConversationDto, nullable: true })
  conversation: LeadConversationDto | null;
}

export class ColumnDto {
  @ApiProperty({ type: StageDto })
  stage: StageDto;

  @ApiProperty({ description: 'Leads of the stage for the filters.' })
  count: number;

  @ApiProperty({ description: 'Sum of their values, in cents.' })
  totalCents: number;

  @ApiProperty({ description: 'More with GET …/stages/:stageId/leads.' })
  hasMore: boolean;

  @ApiProperty({ type: [LeadDto] })
  leads: LeadDto[];
}

export class BoardDto {
  @ApiProperty({ type: FunnelDto })
  funnel: FunnelDto;

  @ApiProperty({ type: BoardPreferencesDto })
  preferences: BoardPreferencesDto;

  @ApiProperty({ type: [ColumnDto] })
  columns: ColumnDto[];

  @ApiProperty()
  count: number;

  @ApiProperty()
  totalCents: number;
}

export class LeadPageDto {
  @ApiProperty({ type: [LeadDto] })
  leads: LeadDto[];

  @ApiProperty()
  hasMore: boolean;
}

export class BulkResultDto {
  @ApiProperty()
  affected: number;
}

export class SyncResultDto {
  @ApiProperty({ description: 'Contacts added to the funnel.' })
  created: number;

  @ApiProperty({ description: 'Already in the funnel: their stage was kept.' })
  skipped: number;

  @ApiProperty()
  failed: number;
}

export class MemberPermissionsDto {
  @ApiProperty({ format: 'uuid' })
  membershipId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: [String], description: 'Empty: every stage.' })
  stageIds: string[];
}

export class FunnelPermissionsViewDto {
  @ApiProperty({ type: [StageDto] })
  stages: StageDto[];

  @ApiProperty({ type: [MemberPermissionsDto] })
  members: MemberPermissionsDto[];
}

export class ContactLeadDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ format: 'uuid' })
  stageId: string;

  @ApiProperty()
  amountCents: number;

  @ApiProperty({ type: Date, nullable: true })
  archivedAt: Date | null;

  @ApiProperty()
  version: number;
}

export class ContactFunnelDto {
  @ApiProperty({ format: 'uuid' })
  funnelId: string;

  @ApiProperty()
  funnelName: string;

  @ApiProperty({ format: 'uuid' })
  lineId: string;

  @ApiProperty()
  lineName: string;

  @ApiProperty({ type: [StageDto] })
  stages: StageDto[];

  @ApiProperty({ type: ContactLeadDto, nullable: true })
  lead: ContactLeadDto | null;
}

export class AutomationRuleViewDto extends AutomationRuleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  lineId: string;
}
