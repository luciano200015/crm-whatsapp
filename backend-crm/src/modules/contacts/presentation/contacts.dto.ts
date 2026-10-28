import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../../database/mongodb/pagination';
import {
  FIELD_TYPES,
  MAX_FIELD_OPTIONS,
  type FieldType,
} from '../domain/contact-fields';
import { TAG_COLOR_FORMAT } from '../domain/tags';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const MAX_TAGS_PER_CONTACT = 50;
export const MAX_IMPORT_ROWS = 200;
export const MAX_BULK_CONTACTS = 500;
const CONTACT_STATUSES = ['ACTIVE', 'BLOCKED'] as const;

const FIELDS_DESCRIPTION =
  'Custom field values by key (GET /contact-fields). null or "" clears one. TEXT and SELECT are strings, NUMBER a number, DATE YYYY-MM-DD.';

// ─────────────────────────── Requests ───────────────────────────

export class ExportContactsQueryDto {
  @ApiPropertyOptional({ description: 'Part of the name, email or phone.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Only contacts with this tag.' })
  @IsOptional()
  @IsMongoId()
  tagId?: string;

  @ApiPropertyOptional({
    enum: CONTACT_STATUSES,
    description: 'ACTIVE (not blocked) or BLOCKED.',
  })
  @IsOptional()
  @IsIn(CONTACT_STATUSES)
  status?: (typeof CONTACT_STATUSES)[number];
}

export class ListContactsQueryDto {
  @ApiPropertyOptional({ description: 'Part of the name, email or phone.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Only contacts with this tag.' })
  @IsOptional()
  @IsMongoId()
  tagId?: string;

  @ApiPropertyOptional({
    enum: CONTACT_STATUSES,
    description: 'ACTIVE (not blocked) or BLOCKED.',
  })
  @IsOptional()
  @IsIn(CONTACT_STATUSES)
  status?: (typeof CONTACT_STATUSES)[number];

  @ApiPropertyOptional({ description: '`nextCursor` of the previous page.' })
  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @ApiPropertyOptional({
    default: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;
}

export class CreateContactDto {
  @ApiProperty({
    example: '+59171234567',
    description: 'International format. Stored as E.164.',
  })
  @IsString()
  @MaxLength(32)
  phone: string;

  @ApiPropertyOptional({ example: 'Lucía Fernández', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  name?: string | null;

  @ApiPropertyOptional({ example: 'lucia@example.com', nullable: true })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Tag ids of this workspace.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_CONTACT)
  @IsMongoId({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: FIELDS_DESCRIPTION,
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}

export class UpdateContactDto {
  @ApiPropertyOptional({ example: '+59171234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  name?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_CONTACT)
  @IsMongoId({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: `${FIELDS_DESCRIPTION} Only the keys sent change.`,
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}

export class LineAgentEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  lineId: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'null removes the regular agent of that line.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  membershipId: string | null;
}

export class SetLineAgentsDto {
  @ApiProperty({
    type: [LineAgentEntryDto],
    description: 'Lines not listed keep their regular agent.',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LineAgentEntryDto)
  agents: LineAgentEntryDto[];
}

export class BulkContactsDto {
  @ApiProperty({ type: [String], maxItems: MAX_BULK_CONTACTS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_CONTACTS)
  @IsMongoId({ each: true })
  contactIds: string[];

  @ApiProperty({ enum: ['add_tags', 'remove_tags', 'delete'] })
  @IsIn(['add_tags', 'remove_tags', 'delete'])
  action: 'add_tags' | 'remove_tags' | 'delete';

  @ApiPropertyOptional({
    type: [String],
    description: 'Tag ids for add_tags and remove_tags.',
  })
  @ValidateIf((dto: BulkContactsDto) => dto.action !== 'delete')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TAGS_PER_CONTACT)
  @IsMongoId({ each: true })
  tagIds?: string[];
}

export class DeleteAllContactsDto {
  @ApiProperty({ example: 'ELIMINAR', description: 'Must be ELIMINAR.' })
  @IsString()
  @MaxLength(20)
  confirmation: string;
}

export class ImportRowDto {
  @ApiProperty({ example: '+59171234567' })
  @IsString()
  @MaxLength(64)
  phone: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Tag names; the missing ones are created.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_CONTACT)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Custom field values by key; unknown keys are skipped.',
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}

export class ImportContactsDto {
  @ApiProperty({ type: [ImportRowDto], maxItems: MAX_IMPORT_ROWS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMPORT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows: ImportRowDto[];

  @ApiProperty({
    enum: ['REPLACE', 'MERGE'],
    description:
      'Contacts that already exist: «Reescribir etiquetas» (REPLACE) or «Combinar etiquetas» (MERGE).',
  })
  @IsIn(['REPLACE', 'MERGE'])
  tagMode: 'REPLACE' | 'MERGE';
}

export class CreateContactFieldDto {
  @ApiProperty({ example: 'Fecha de nacimiento', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  label: string;

  @ApiProperty({ enum: FIELD_TYPES })
  @IsIn(FIELD_TYPES)
  type: FieldType;

  @ApiPropertyOptional({
    type: [String],
    description: 'Options of a SELECT field.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FIELD_OPTIONS)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  options?: string[];
}

export class UpdateContactFieldDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  label?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FIELD_OPTIONS)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  options?: string[];
}

export class SetContactTagsDto {
  @ApiProperty({ type: [String], description: 'Replaces the contact tags.' })
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_CONTACT)
  @IsMongoId({ each: true })
  tagIds: string[];
}

export class CreateTagDto {
  @ApiProperty({ example: 'Cliente', maxLength: 40 })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name: string;

  @ApiProperty({ example: '#22c55e', description: '#RRGGBB' })
  @Matches(TAG_COLOR_FORMAT, { message: 'color must be #RRGGBB' })
  color: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;
}

export class UpdateTagDto {
  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name?: string;

  @ApiPropertyOptional({ example: '#3b82f6' })
  @IsOptional()
  @Matches(TAG_COLOR_FORMAT, { message: 'color must be #RRGGBB' })
  color?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;
}

// ─────────────────────────── Responses ───────────────────────────

export class TagSummaryDto {
  @ApiProperty({ example: '6716f0c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Cliente' })
  name: string;

  @ApiProperty({ example: '#22c55e' })
  color: string;
}

export class BlockedByDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;
}

export class ContactDto {
  @ApiProperty({ example: '6716f0c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: '+59171234567' })
  phone: string;

  @ApiProperty({ nullable: true, type: String })
  name: string | null;

  @ApiProperty({ nullable: true, type: String })
  email: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ type: [TagSummaryDto] })
  tags: TagSummaryDto[];

  @ApiProperty({ enum: ['manual', 'whatsapp', 'import'] })
  source: string;

  @ApiProperty({ nullable: true, type: Date })
  lastMessageAt: Date | null;

  @ApiProperty({
    description:
      'Blocked: their WhatsApp messages are ignored (POST …/contacts/:id/block).',
  })
  blocked: boolean;

  @ApiProperty({ nullable: true, type: Date })
  blockedAt: Date | null;

  @ApiProperty({ type: BlockedByDto, nullable: true })
  blockedBy: BlockedByDto | null;

  @ApiProperty({
    type: () => [LineAgentDto],
    description: 'Regular agent per line («Asignación de asesores»).',
  })
  lineAgents: LineAgentDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Custom field values by key.',
  })
  fields: Record<string, string | number>;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class LineAgentDto {
  @ApiProperty({ format: 'uuid' })
  lineId: string;

  @ApiProperty({ format: 'uuid' })
  membershipId: string;
}

export class AgentOptionDto {
  @ApiProperty({ format: 'uuid' })
  membershipId: string;

  @ApiProperty()
  name: string;
}

export class LineAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  lineId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, type: String })
  displayPhone: string | null;

  @ApiProperty({
    type: [AgentOptionDto],
    description:
      'Who can be the regular agent: the line agents and view_all members.',
  })
  agents: AgentOptionDto[];

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  agentMembershipId: string | null;

  @ApiProperty({
    type: AgentOptionDto,
    nullable: true,
    description: '«Atendiendo ahora»: assignee of the open or on-hold chat.',
  })
  attending: AgentOptionDto | null;
}

export class BulkResultDto {
  @ApiProperty({ example: 12 })
  affected: number;
}

export class DeleteAllResultDto {
  @ApiProperty({ example: 340 })
  deleted: number;
}

export class ImportFailureDto {
  @ApiProperty({ description: 'Position of the row in the request.' })
  index: number;

  @ApiProperty()
  phone: string;

  @ApiProperty({
    example: 'INVALID_PHONE',
    description:
      'INVALID_PHONE, INVALID_EMAIL, CONTACT_FIELD_INVALID_VALUE or CONTACT_PHONE_TAKEN.',
  })
  code: string;
}

export class ImportResultDto {
  @ApiProperty()
  created: number;

  @ApiProperty()
  updated: number;

  @ApiProperty({ type: [ImportFailureDto] })
  failed: ImportFailureDto[];
}

export class ContactFieldDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    example: 'fecha_de_nacimiento',
    description: 'Derived from the first label; never changes.',
  })
  key: string;

  @ApiProperty({ example: 'Fecha de nacimiento' })
  label: string;

  @ApiProperty({ enum: FIELD_TYPES })
  type: string;

  @ApiProperty({ type: [String] })
  options: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ContactPageDto {
  @ApiProperty({ type: [ContactDto] })
  items: ContactDto[];

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Cursor of the next page; null on the last one.',
  })
  nextCursor: string | null;
}

export class TagDto extends TagSummaryDto {
  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ example: 12 })
  contactCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
