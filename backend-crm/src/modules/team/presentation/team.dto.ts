import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MembershipStatus } from '../../../generated/prisma/client';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_GROUPS,
  type PermissionKey,
} from '../../authorization/domain/permission-catalog';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const MEMBER_STATUSES = Object.values(MembershipStatus);

// ─────────────────────────── Requests ───────────────────────────

export class ListMembersQueryDto {
  @ApiPropertyOptional({ enum: MEMBER_STATUSES })
  @IsOptional()
  @IsIn(MEMBER_STATUSES)
  status?: MembershipStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only members with this role.',
  })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({
    description: 'Part of the name or email.',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

export class CreateMemberDto {
  @ApiProperty({ example: 'carla@example.com', maxLength: 320 })
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({
    example: 'Carla Pérez',
    maxLength: 120,
    description: 'Only used when the email has no account yet.',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  displayName: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'A system role or a custom role of this workspace (GET …/roles).',
  })
  @IsUUID()
  roleId: string;
}

export class ChangeMemberRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roleId: string;
}

export class SetMemberLinesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: 100,
    description:
      'Every WhatsApp line the member attends (replaces the current ones). An empty list leaves an agent without chats.',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  lineIds: string[];
}

export class CreateRoleDto {
  @ApiProperty({ example: 'Supervisor', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name: string;

  @ApiPropertyOptional({
    example: 'Supervises the agents',
    maxLength: 300,
    nullable: true,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiProperty({
    enum: ALL_PERMISSION_KEYS,
    isArray: true,
    example: ['contacts.read', 'messages.read', 'messages.send'],
    description:
      'Permission keys from GET …/permissions. You can only grant permissions you hold.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ALL_PERMISSION_KEYS.length)
  @IsIn(ALL_PERMISSION_KEYS, { each: true })
  permissions: PermissionKey[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'Supervisor', maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name?: string;

  @ApiPropertyOptional({ maxLength: 300, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({ enum: ALL_PERMISSION_KEYS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ALL_PERMISSION_KEYS.length)
  @IsIn(ALL_PERMISSION_KEYS, { each: true })
  permissions?: PermissionKey[];
}

// ─────────────────────────── Responses ───────────────────────────

export class MemberRoleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'AGENT' })
  key: string;

  @ApiProperty({ example: 'Agent' })
  name: string;

  @ApiProperty({
    description: 'System role (read-only) or custom role of this workspace.',
  })
  system: boolean;
}

export class MemberLineDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ventas' })
  name: string;

  @ApiProperty({ nullable: true, type: String, example: '+591 70000000' })
  displayPhone: string | null;
}

export class MemberDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Membership id (use it in /members/{memberId}).',
  })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'carla@example.com' })
  email: string;

  @ApiProperty({ example: 'Carla Pérez' })
  displayName: string;

  @ApiProperty({ nullable: true, type: String })
  avatarUrl: string | null;

  @ApiProperty({ enum: MEMBER_STATUSES, enumName: 'MembershipStatus' })
  status: MembershipStatus;

  @ApiProperty({
    description: 'Still has the temporary password sent by email.',
  })
  pendingFirstAccess: boolean;

  @ApiProperty({ nullable: true, type: Date })
  lastLoginAt: Date | null;

  @ApiProperty()
  joinedAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  deactivatedAt: Date | null;

  @ApiProperty({ type: MemberRoleDto, nullable: true })
  role: MemberRoleDto | null;

  @ApiProperty({ type: [String], example: ['contacts.read', 'messages.send'] })
  permissions: string[];

  @ApiProperty({
    type: [MemberLineDto],
    description:
      'WhatsApp lines the member attends. Without conversations.view_all they only see chats of these lines.',
  })
  lines: MemberLineDto[];
}

export class AgentUsageDto {
  @ApiProperty({ example: 4 })
  activeMembers: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 10,
    description: 'limits.agents of the plan; null = unlimited.',
  })
  limit: number | null;
}

export class MemberListDto {
  @ApiProperty({ type: [MemberDto] })
  items: MemberDto[];

  @ApiProperty({ example: 4 })
  total: number;

  @ApiProperty({ type: AgentUsageDto })
  usage: AgentUsageDto;
}

export class RoleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'supervisor' })
  key: string;

  @ApiProperty({ example: 'Supervisor' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({
    description:
      'System role (workspaceId null): read-only. Otherwise a custom role of this workspace.',
  })
  system: boolean;

  @ApiProperty({ enum: ALL_PERMISSION_KEYS, isArray: true })
  permissions: string[];

  @ApiProperty({
    example: 2,
    description: 'Members of this workspace with the role.',
  })
  memberCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PermissionDto {
  @ApiProperty({ enum: ALL_PERMISSION_KEYS })
  key: string;

  @ApiProperty({ enum: PERMISSION_GROUPS })
  group: string;

  @ApiProperty({ example: 'View contacts' })
  description: string;
}
