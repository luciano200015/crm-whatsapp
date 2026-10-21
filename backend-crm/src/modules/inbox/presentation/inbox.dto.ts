import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const VIEWS = ['mine', 'unassigned', 'all'] as const;
const STATUSES = ['OPEN', 'CLOSED'] as const;
const STATUS_FILTERS = ['OPEN', 'CLOSED', 'ALL'] as const;
const DIRECTIONS = ['IN', 'OUT', 'NOTE', 'EVENT'] as const;
const EVENT_KINDS = [
  'auto_assigned',
  'assigned',
  'transferred',
  'unassigned',
  'taken',
  'claimed',
  'closed',
  'reopened',
  'contact_blocked',
  'contact_unblocked',
] as const;

// ─────────────────────────── Requests ───────────────────────────

export class ListConversationsQueryDto {
  @ApiPropertyOptional({
    enum: VIEWS,
    default: 'mine',
    description:
      'mine: assigned to me. unassigned: nobody has it. all: everything I can see (all of the workspace with conversations.view_all).',
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

export class InboxOptionsDto {
  @ApiProperty({ type: [InboxLineOptionDto] })
  lines: InboxLineOptionDto[];

  @ApiProperty({ type: [AssigneeDto] })
  members: AssigneeDto[];
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
}

export class ConversationContactDto {
  @ApiProperty({ nullable: true, type: String })
  name: string | null;

  @ApiProperty({ example: '+59171234567' })
  phone: string;
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

  @ApiProperty({ description: 'Open, unassigned and visible to me.' })
  unassigned: number;

  @ApiProperty({ description: 'Open and visible to me.' })
  all: number;

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
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;
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

  @ApiProperty({ type: ConversationEventDto, nullable: true })
  event: ConversationEventDto | null;

  @ApiProperty({
    enum: ['received', 'pending', 'sent', 'delivered', 'read', 'failed'],
  })
  status: string;

  @ApiProperty({ nullable: true, type: String })
  error: string | null;

  @ApiProperty({ type: SentByDto, nullable: true })
  sentBy: SentByDto | null;

  @ApiProperty()
  createdAt: Date;
}

export class MessagePageDto {
  @ApiProperty({ type: [MessageDto], description: 'Newest first.' })
  items: MessageDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor: string | null;
}
