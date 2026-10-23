import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

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

const SORTS = ['recent', 'oldest'] as const;

const VIEWS = ['mine', 'unassigned', 'all'] as const;
const STATUSES = ['OPEN', 'ON_HOLD', 'CLOSED'] as const;
const STATUS_FILTERS = ['OPEN', 'ON_HOLD', 'CLOSED', 'ALL'] as const;
const DIRECTIONS = ['IN', 'OUT', 'NOTE', 'EVENT'] as const;
const EVENT_KINDS = [
  'auto_assigned',
  'assigned',
  'transferred',
  'unassigned',
  'taken',
  'claimed',
  'on_hold',
  'closed',
  'reopened',
  'contact_blocked',
  'contact_unblocked',
  'bot_paused',
  'bot_resumed',
  'bot_transferred',
] as const;

// ─────────────────────────── Requests ───────────────────────────

export class ListConversationsQueryDto {
  @ApiPropertyOptional({
    enum: VIEWS,
    default: 'mine',
    description:
      'mine: assigned to me. all: mine, those of my agents and the unassigned ones I can see (all of the workspace with conversations.view_all; without it, mine and the unassigned of the lines I attend). unassigned: nobody has it (kept for older clients).',
  })
  @IsOptional()
  @IsIn(VIEWS)
  view: (typeof VIEWS)[number] = 'mine';

  @ApiPropertyOptional({ enum: STATUS_FILTERS, default: 'OPEN' })
  @IsOptional()
  @IsIn(STATUS_FILTERS)
  status: (typeof STATUS_FILTERS)[number] = 'OPEN';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lineId?: string;

  @ApiPropertyOptional({ description: 'Conversations of one contact.' })
  @IsOptional()
  @IsMongoId()
  contactId?: string;

  @ApiPropertyOptional({ description: 'Part of the contact name or phone.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Contacts with any of these tags (ids, comma separated).',
  })
  @IsOptional()
  @Transform(list)
  @IsArray()
  @ArrayMaxSize(20)
  @IsMongoId({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Assigned to these membership ids; `none` = unassigned. Requires conversations.view_all (403 AGENT_FILTER_FORBIDDEN).',
  })
  @IsOptional()
  @Transform(list)
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(
    /^(none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    { each: true, message: 'each assigneeIds must be a membership id or none' },
  )
  assigneeIds?: string[];

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Last activity from this moment.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Last activity up to this moment.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ enum: SORTS, default: 'recent' })
  @IsOptional()
  @IsIn(SORTS)
  sort: (typeof SORTS)[number] = 'recent';

  @ApiPropertyOptional({ description: '`nextCursor` of the previous page.' })
  @IsOptional()
  @Matches(/^\d{1,16}_[0-9a-f]{24}$/, { message: 'cursor is invalid' })
  cursor?: string;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;
}

export class ListMessagesQueryDto {
  @ApiPropertyOptional({
    description: 'Older messages: `nextCursor` of the previous page.',
  })
  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class SendTextDto {
  @ApiProperty({ example: '¡Hola! ¿En qué te puedo ayudar?', maxLength: 4096 })
  @Transform(trim)
  @IsString()
  @Length(1, 4096)
  text: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Id the browser gives the message to show it at once; it comes back on the message and its events.',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

export class OutgoingContactDto {
  @ApiProperty({ example: 'Ana Pérez', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiProperty({
    example: '+59171234567',
    description: 'International format.',
  })
  @Transform(trim)
  @IsString()
  @Length(5, 32)
  phone: string;
}

export class SendContactsDto {
  @ApiProperty({ type: [OutgoingContactDto], minItems: 1, maxItems: 5 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => OutgoingContactDto)
  contacts: OutgoingContactDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Id the browser gives the message to show it at once; it comes back on the message and its events.',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

/** Text fields of the multipart upload; the file itself is read by multer. */
export class SendMediaDto {
  @ApiPropertyOptional({
    maxLength: 1024,
    description: 'Shown under images, videos and documents (not audio).',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1024)
  caption?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Id the browser gives the message to show it at once; it comes back on the message and its events.',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

export class AssignConversationDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Membership id of an active member, or null to unassign.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  membershipId: string | null;
}

// ─────────────────────────── Responses ───────────────────────────

export class AssigneeDto {
  @ApiProperty({ format: 'uuid' })
  membershipId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'Andrés Agente' })
  name: string;
}

export class InboxLineOptionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class InboxVisibleLineDto extends InboxLineOptionDto {
  @ApiProperty({ nullable: true, type: String, example: '+591 70000000' })
  displayPhone: string | null;

  @ApiProperty({ example: 'CONNECTED' })
  status: string;

  @ApiProperty({ nullable: true, type: String, example: '#303f9f' })
  color: string | null;
}

export class MemberReachDto extends AssigneeDto {
  @ApiProperty({ type: [String], description: 'Lines the member attends.' })
  lineIds: string[];

  @ApiProperty({ description: 'Their role sees every conversation.' })
  viewAll: boolean;
}

export class InboxOptionsDto {
  @ApiProperty({
    description: 'conversations.view_all: the member sees every line.',
  })
  viewAll: boolean;

  @ApiProperty({
    type: [String],
    description:
      'Lines the member attends. Without view_all they only see chats of these lines; none means an empty inbox.',
  })
  myLineIds: string[];

  @ApiProperty({ type: [InboxVisibleLineDto] })
  lines: InboxVisibleLineDto[];

  @ApiProperty({
    type: [MemberReachDto],
    description:
      'With conversations.assign: who a chat can go to (members of its line, or with view_all).',
  })
  members: MemberReachDto[];
}

export class AssignmentLineDto extends InboxLineOptionDto {
  @ApiProperty()
  status: string;

  @ApiProperty()
  autoAssign: boolean;

  @ApiProperty({ type: [String] })
  membershipIds: string[];
}

export class AutoAssignmentOptionsDto {
  @ApiProperty({ type: [AssignmentLineDto] })
  lines: AssignmentLineDto[];

  @ApiProperty({ type: [AssigneeDto] })
  members: AssigneeDto[];
}

export class LastMessageDto {
  @ApiProperty({ nullable: true, type: String })
  text: string | null;

  @ApiProperty({ example: 'text' })
  type: string;

  @ApiProperty({ enum: DIRECTIONS })
  direction: string;

  @ApiProperty()
  at: Date;

  @ApiPropertyOptional({ nullable: true, type: String })
  messageId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Delivery status of that message (✓, ✓✓, read, failed).',
  })
  status?: string | null;
}

export class ConversationContactDto {
  @ApiProperty({ nullable: true, type: String })
  name: string | null;

  @ApiProperty({ example: '+59171234567' })
  phone: string;
}

export class ConversationBotDto {
  @ApiProperty({
    enum: ['none', 'active', 'paused'],
    description:
      'none: the line has no enabled chatbot. paused: an agent turned it off in this chat.',
  })
  state: string;

  @ApiProperty({ nullable: true, type: String, example: 'Bot de ventas' })
  name: string | null;

  @ApiProperty({ type: () => SentByDto, nullable: true })
  pausedBy: SentByDto | null;
}

export class ConversationDto {
  @ApiProperty({ example: '6716f0c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  lineId: string;

  @ApiProperty({ nullable: true, type: String, example: 'Ventas' })
  lineName: string | null;

  @ApiProperty({ example: '6716f0c2a1b2c3d4e5f60719' })
  contactId: string;

  @ApiProperty({ type: ConversationContactDto })
  contact: ConversationContactDto;

  @ApiProperty({ enum: STATUSES })
  status: string;

  @ApiProperty({ type: AssigneeDto, nullable: true })
  assignee: AssigneeDto | null;

  @ApiProperty({
    type: [String],
    description: 'Tag ids of the contact (GET /tags has their names).',
  })
  contactTagIds: string[];

  @ApiProperty({ type: LastMessageDto, nullable: true })
  lastMessage: LastMessageDto | null;

  @ApiProperty()
  lastActivityAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  lastInboundAt: Date | null;

  @ApiProperty({
    description: 'Within the 24 h window: free text replies are allowed.',
  })
  windowOpen: boolean;

  @ApiProperty({ nullable: true, type: Date })
  windowExpiresAt: Date | null;

  @ApiProperty({ example: 2 })
  unreadCount: number;

  @ApiProperty({ nullable: true, type: Date })
  closedAt: Date | null;

  @ApiProperty({ type: ConversationBotDto })
  bot: ConversationBotDto;

  @ApiProperty()
  createdAt: Date;
}

export class ConversationPageDto {
  @ApiProperty({ type: [ConversationDto] })
  items: ConversationDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}

export class InboxCountsDto {
  @ApiProperty({ description: 'Open conversations assigned to me.' })
  mine: number;

  @ApiProperty({ description: 'On hold and assigned to me.' })
  mineOnHold: number;

  @ApiProperty({ description: 'Closed and assigned to me.' })
  mineClosed: number;

  @ApiProperty({ description: 'Open, unassigned and visible to me.' })
  unassigned: number;

  @ApiProperty({ description: 'Open and visible to me.' })
  all: number;

  @ApiProperty({ description: 'On hold and visible to me.' })
  onHold: number;

  @ApiProperty({ description: 'Closed and visible to me.' })
  closed: number;

  @ApiProperty({
    description: 'Unread messages in open conversations visible to me.',
  })
  unread: number;
}

export class MediaDto {
  @ApiProperty({
    description:
      'The message id: GET /conversations/:id/messages/:messageId/media streams the file.',
  })
  id: string;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Bytes, once stored.',
  })
  size: number | null;

  @ApiProperty({ nullable: true, type: String })
  mimeType: string | null;

  @ApiProperty({ nullable: true, type: String })
  caption: string | null;

  @ApiProperty({ nullable: true, type: String })
  filename: string | null;
}

export class LocationDto {
  @ApiProperty({ example: -16.5 })
  latitude: number;

  @ApiProperty({ example: -68.15 })
  longitude: number;

  @ApiProperty({ nullable: true, type: String })
  name: string | null;

  @ApiProperty({ nullable: true, type: String })
  address: string | null;
}

export class EventPartyDto {
  @ApiProperty({ format: 'uuid' })
  membershipId: string;

  @ApiProperty()
  name: string;
}

export class SentByDto {
  @ApiProperty({
    description: 'The user; "bot:<chatbot id>" for a chatbot.',
  })
  userId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ enum: ['user', 'bot'] })
  kind?: string;
}

export class InteractiveOptionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;
}

export class InteractiveRowDto extends InteractiveOptionDto {
  @ApiProperty({ nullable: true, type: String })
  description: string | null;
}

export class InteractiveSectionDto {
  @ApiProperty({ nullable: true, type: String })
  title: string | null;

  @ApiProperty({ type: [InteractiveRowDto] })
  rows: InteractiveRowDto[];
}

export class InteractiveListDto {
  @ApiProperty()
  button: string;

  @ApiProperty({ type: [InteractiveSectionDto] })
  sections: InteractiveSectionDto[];
}

export class InteractiveUrlDto {
  @ApiProperty()
  text: string;

  @ApiProperty()
  url: string;
}

export class InteractiveDto {
  @ApiProperty({ enum: ['buttons', 'list', 'cta_url'] })
  kind: string;

  @ApiProperty({ nullable: true, type: String })
  header: string | null;

  @ApiProperty()
  body: string;

  @ApiProperty({ nullable: true, type: String })
  footer: string | null;

  @ApiPropertyOptional({ type: [InteractiveOptionDto] })
  buttons?: InteractiveOptionDto[];

  @ApiPropertyOptional({ type: InteractiveListDto })
  list?: InteractiveListDto;

  @ApiPropertyOptional({ type: InteractiveUrlDto })
  url?: InteractiveUrlDto;
}

export class SharedContactPhoneDto {
  @ApiProperty()
  phone: string;

  @ApiProperty({ nullable: true, type: String })
  waId: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'CELL' })
  type: string | null;
}

export class SharedContactDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ type: [SharedContactPhoneDto] })
  phones: SharedContactPhoneDto[];

  @ApiProperty({ type: [String] })
  emails: string[];

  @ApiProperty({ nullable: true, type: String })
  organization: string | null;
}

export class ConversationEventDto {
  @ApiProperty({ enum: EVENT_KINDS })
  kind: string;

  @ApiProperty({
    type: () => SentByDto,
    nullable: true,
    description: 'Who did it; null when the system did (auto-assignment).',
  })
  by: SentByDto | null;

  @ApiProperty({ type: EventPartyDto, nullable: true })
  from: EventPartyDto | null;

  @ApiProperty({ type: EventPartyDto, nullable: true })
  to: EventPartyDto | null;
}

export class MessageDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  conversationId: string;

  @ApiProperty({
    enum: DIRECTIONS,
    description:
      'NOTE: internal note, never sent to WhatsApp. EVENT: a movement of the conversation (see `event`).',
  })
  direction: string;

  @ApiProperty({
    enum: [
      'text',
      'image',
      'audio',
      'video',
      'document',
      'sticker',
      'location',
      'contacts',
      'interactive',
      'unsupported',
    ],
  })
  type: string;

  @ApiProperty({ nullable: true, type: String })
  text: string | null;

  @ApiProperty({ type: MediaDto, nullable: true })
  media: MediaDto | null;

  @ApiProperty({ type: LocationDto, nullable: true })
  location: LocationDto | null;

  @ApiProperty({
    type: [SharedContactDto],
    description: 'Contact cards (type "contacts").',
  })
  contacts: SharedContactDto[];

  @ApiProperty({ type: ConversationEventDto, nullable: true })
  event: ConversationEventDto | null;

  @ApiProperty({
    type: InteractiveDto,
    nullable: true,
    description:
      'Buttons, list or link button of a chatbot (type "interactive").',
  })
  interactive: InteractiveDto | null;

  @ApiProperty({
    type: InteractiveOptionDto,
    nullable: true,
    description: 'The option the customer tapped in buttons or a list.',
  })
  reply: InteractiveOptionDto | null;

  @ApiProperty({
    enum: ['received', 'pending', 'sent', 'delivered', 'read', 'failed'],
  })
  status: string;

  @ApiProperty({ nullable: true, type: String })
  error: string | null;

  @ApiProperty({ type: SentByDto, nullable: true })
  sentBy: SentByDto | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'clientId sent by the browser that wrote the message.',
  })
  clientId: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class MessagePageDto {
  @ApiProperty({ type: [MessageDto], description: 'Newest first.' })
  items: MessageDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}

export class LineBlockResultDto {
  @ApiProperty({ format: 'uuid' })
  lineId: string;

  @ApiProperty()
  lineName: string;

  @ApiProperty({ description: 'False when WhatsApp refused it.' })
  ok: boolean;

  @ApiProperty({ nullable: true, type: String })
  error: string | null;
}

export class BlockResultDto {
  @ApiProperty()
  blocked: boolean;

  @ApiProperty({
    type: [LineBlockResultDto],
    description: 'WhatsApp block per line the contact wrote to.',
  })
  whatsapp: LineBlockResultDto[];
}
