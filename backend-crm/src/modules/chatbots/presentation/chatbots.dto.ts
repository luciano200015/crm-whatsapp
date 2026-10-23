import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// ─────────────────────────── Requests ───────────────────────────

export class CreateChatbotDto {
  @ApiProperty({ example: 'Bot de ventas', maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;
}

export class UpdateChatbotDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Turns the chatbot on or off. On requires a complete flow (409 FLOW_INCOMPLETE).',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'The flow: { nodes, edges } as the editor saves it (400 FLOW_INVALID).',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  graph?: Record<string, unknown>;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Hours it answers: { timezone, days: [{ day: 0-6, ranges: [{ from: "09:00", to: "18:00" }] }] }; null = always.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  schedule?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    minimum: 5,
    maximum: 10080,
    description: 'A conversation idle this long starts the flow again.',
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(10080)
  restartAfterMinutes?: number;
}

export class SetChatbotLinesDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  lineIds: string[];

  @ApiPropertyOptional({
    description:
      'Move lines that answer with another chatbot to this one (otherwise 409 LINE_HAS_CHATBOT).',
  })
  @IsOptional()
  @IsBoolean()
  takeOver?: boolean;
}

export class SimulateChatbotDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  graph: Record<string, unknown>;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'The session returned by the previous run (null: start).',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsObject()
  session?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 4096 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(4096)
  text?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 256 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(256)
  replyId?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, maxLength: 80 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(80)
  contactName?: string | null;
}

// ─────────────────────────── Responses ───────────────────────────

export class ChatbotLineDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ventas' })
  name: string;
}

export class ChatbotSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Bot de ventas' })
  name: string;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ type: [ChatbotLineDto] })
  lines: ChatbotLineDto[];

  @ApiProperty({ description: 'Errors to fix before it can be turned on.' })
  errors: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class FlowIssueDto {
  @ApiProperty({ nullable: true, type: String })
  nodeId: string | null;

  @ApiProperty({ enum: ['error', 'warning'] })
  level: string;

  @ApiProperty({ example: 'Agrega al menos un botón' })
  message: string;
}

export class ChatbotDto extends ChatbotSummaryDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: '{ nodes, edges }',
  })
  graph: object;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  schedule: object | null;

  @ApiProperty({ example: 60 })
  restartAfterMinutes: number;

  @ApiProperty({ type: [FlowIssueDto] })
  issues: FlowIssueDto[];
}

export class BotMediaDto {
  @ApiProperty()
  fileId: string;

  @ApiProperty({ enum: ['image', 'video', 'audio', 'document'] })
  type: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  filename: string;

  @ApiProperty()
  size: number;
}

export class SimulationDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'What the chatbot would do, in order: send (a message), tags, transfer, status.',
  })
  actions: object[];

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'Send it back with the next answer; null = the flow ended.',
  })
  session: object | null;
}
