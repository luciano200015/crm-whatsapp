import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../../database/mongodb/pagination';
import { TAG_COLOR_FORMAT } from '../domain/tags';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const MAX_TAGS_PER_CONTACT = 50;

// ─────────────────────────── Requests ───────────────────────────

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

  @ApiProperty({ enum: ['manual', 'whatsapp'] })
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
