import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const META_ID = /^[0-9]{5,32}$/;

// ─────────────────────────── Requests ───────────────────────────

export class CreateLineDto {
  @ApiProperty({ example: 'Ventas', maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiProperty({
    example: '106540352242922',
    description: 'Phone number ID (WhatsApp Manager → API Setup).',
  })
  @Transform(trim)
  @Matches(META_ID, {
    message: 'phoneNumberId must be the numeric id from Meta',
  })
  phoneNumberId: string;

  @ApiPropertyOptional({ example: '102290129340398', nullable: true })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null)
  @Matches(META_ID, { message: 'wabaId must be the numeric id from Meta' })
  wabaId?: string | null;

  @ApiPropertyOptional({ example: '+591 71234567', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  displayPhone?: string | null;

  @ApiProperty({
    description: 'Permanent access token of a System User. Stored encrypted.',
    format: 'password',
  })
  @Transform(trim)
  @IsString()
  @Length(20, 1024)
  accessToken: string;

  @ApiProperty({
    description:
      'App Secret of the Meta app (verifies webhook signatures). Stored encrypted.',
    format: 'password',
  })
  @Transform(trim)
  @IsString()
  @Length(16, 256)
  appSecret: string;
}

export class UpdateLineDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @Matches(META_ID, {
    message: 'phoneNumberId must be the numeric id from Meta',
  })
  phoneNumberId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => value !== null)
  @Matches(META_ID, { message: 'wabaId must be the numeric id from Meta' })
  wabaId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(32)
  displayPhone?: string | null;

  @ApiPropertyOptional({
    description: 'Only to replace it.',
    format: 'password',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(20, 1024)
  accessToken?: string;

  @ApiPropertyOptional({
    description: 'Only to replace it.',
    format: 'password',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(16, 256)
  appSecret?: string;

  @ApiPropertyOptional({ description: 'false disables the line.' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'New conversations are assigned in turns to the line agents.',
  })
  @IsOptional()
  @IsBoolean()
  autoAssign?: boolean;
}

export class SetLineAgentsDto {
  @ApiProperty({
    type: [String],
    description:
      'Membership ids (GET …/members) of the agents who attend the line.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  membershipIds: string[];
}

// ─────────────────────────── Responses ───────────────────────────

export class LineAgentDto {
  @ApiProperty({ format: 'uuid' })
  membershipId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: ['ACTIVE', 'DEACTIVATED'] })
  status: string;
}

export class LineWebhookDto {
  @ApiProperty({
    example: 'https://api.example.com/api/v1/webhooks/whatsapp/0199…',
    description: 'Callback URL to paste in Meta (WhatsApp → Configuration).',
  })
  url: string;

  @ApiProperty({ description: 'Verify token to paste in Meta.' })
  verifyToken: string;
}

export class LineDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ventas' })
  name: string;

  @ApiProperty({ enum: ['WHATSAPP_CLOUD'] })
  provider: string;

  @ApiProperty({ example: '106540352242922' })
  phoneNumberId: string;

  @ApiProperty({ nullable: true, type: String })
  wabaId: string | null;

  @ApiProperty({ nullable: true, type: String, example: '+591 71234567' })
  displayPhone: string | null;

  @ApiProperty({ nullable: true, type: String })
  verifiedName: string | null;

  @ApiProperty({ enum: ['PENDING', 'CONNECTED', 'ERROR', 'DISABLED'] })
  status: string;

  @ApiProperty({ nullable: true, type: String })
  lastError: string | null;

  @ApiProperty({ nullable: true, type: Date })
  lastWebhookAt: Date | null;

  @ApiProperty()
  autoAssign: boolean;

  @ApiProperty({ type: [LineAgentDto] })
  agents: LineAgentDto[];

  @ApiProperty({
    example: 'x9Zq',
    description: 'Last 4 characters of the access token.',
  })
  accessTokenLast4: string;

  @ApiProperty({
    type: LineWebhookDto,
    nullable: true,
    description: 'Only for members with channels.manage.',
  })
  webhook: LineWebhookDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
