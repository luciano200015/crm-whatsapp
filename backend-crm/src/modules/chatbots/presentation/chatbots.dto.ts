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
    minimum: 2,
    maximum: 10080,
    description:
      'A conversation idle this long starts again with the greeting when the customer writes (30 by default).',
  })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10080)
  restartAfterMinutes?: number;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({
    maxLength: 1024,
    description:
      'Sent when the customer writes something the flow does not expect (also after the end of the flow). Empty: nothing.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  fallbackText?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['menu'],
    description: 'Words that send the customer back to the greeting.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  restartKeywords?: string[];

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: 29,
    description:
      'Minutes without an answer before the inactivity message; null: never sent.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(29)
  inactivityMinutes?: number | null;

  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  inactivityText?: string;

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Variables of the chatbot: [{ name, type: text | number | boolean, defaultValue, description }] (400 VARIABLES_INVALID).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  variables?: Record<string, unknown>[];
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

  @ApiPropertyOptional({
    maxLength: 1024,
    description:
      'Sent when the customer writes something the flow does not expect (also after the end of the flow). Empty: nothing.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  fallbackText?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['menu'],
    description: 'Words that send the customer back to the greeting.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  restartKeywords?: string[];

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'The variables being edited, with their types and defaults.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  variables?: Record<string, unknown>[];
}

export class TestApiRequestDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'The data of a «Consulta API» node: method, url, auth, headers, params and responses.',
  })
  @IsObject()
  api: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { cedula: '1234567' },
    description: 'Test values for the {{variables}} of the request.',
  })
  @IsOptional()
  @IsObject()
  sample?: Record<string, string>;
}

// ─────────────────────────── Responses ───────────────────────────

export class ApiTestValueDto {
  @ApiProperty({ example: 'nombre' })
  variable: string;

  @ApiProperty({ example: 'Ana' })
  value: string;
}

export class ApiTestResultDto {
  @ApiProperty({ description: 'The service answered 2xx.' })
  ok: boolean;

  @ApiProperty({ example: 200, description: '0: no answer.' })
  status: number;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Dirección no permitida',
  })
  error: string | null;

  @ApiProperty({ description: 'The answer (up to 2000 characters).' })
  body: string;

  @ApiProperty({
    type: [ApiTestValueDto],
    description: 'What each «Parámetro de respuesta» would save.',
  })
  values: ApiTestValueDto[];
}

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

  @ApiProperty({ example: 'Atención al cliente' })
  description: string;

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

  @ApiProperty({ example: 30 })
  restartAfterMinutes: number;

  @ApiProperty()
  fallbackText: string;

  @ApiProperty({ type: [String], example: ['menu'] })
  restartKeywords: string[];

  @ApiProperty({ nullable: true, type: Number, example: 5 })
  inactivityMinutes: number | null;

  @ApiProperty()
  inactivityText: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: '[{ name, type, defaultValue, description }]',
  })
  variables: object[];

  @ApiProperty({
    type: [String],
    description:
      'Contact data every chatbot can use in texts: {{nombre}}, {{apellido}}, {{nombre_completo}}, {{email}}, {{telefono}}.',
  })
  contactVariables: string[];

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
      'What the chatbot would do, in order: send (a message), tags, transfer, status, contact.',
  })
  actions: object[];

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'Send it back with the next answer; null = the next message starts again. nodeId null: the flow ended but the conversation is still active.',
  })
  session: object | null;
}
