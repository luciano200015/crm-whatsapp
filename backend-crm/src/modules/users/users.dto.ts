import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import {
  MembershipStatus,
  UserStatus,
  WorkspaceStatus,
} from '../../generated/prisma/client';

const TIME_ZONES = Intl.supportedValuesOf('timeZone');

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Summary of the workspace's plan, visible to every member. */
export class WorkspacePlanDto {
  @ApiProperty({ example: 'team' })
  code: string;

  @ApiProperty({ example: 'Equipo' })
  name: string;

  @ApiProperty({
    enum: [
      'TRIALING',
      'ACTIVE',
      'INCOMPLETE',
      'PAST_DUE',
      'CANCELED',
      'EXPIRED',
    ],
  })
  status: string;

  @ApiProperty()
  hasFullAccess: boolean;

  @ApiProperty({ nullable: true, type: Date })
  trialEndsAt: Date | null;

  @ApiProperty({ example: 6 })
  trialDaysLeft: number;
}

export class MyRoleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    example: 'OWNER',
    description:
      'System roles: OWNER, ADMIN, AGENT. Custom roles: a slug of their name.',
  })
  key: string;

  @ApiProperty({ example: 'Owner' })
  name: string;

  @ApiProperty({
    description:
      'System role (workspaceId null, read-only) or a custom role of this workspace.',
  })
  system: boolean;
}

export class MyWorkspaceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Acme Corp' })
  name: string;

  @ApiProperty({ example: 'acme-corp' })
  slug: string;

  @ApiProperty({ enum: WorkspaceStatus, enumName: 'WorkspaceStatus' })
  status: WorkspaceStatus;

  @ApiProperty({ enum: MembershipStatus, enumName: 'MembershipStatus' })
  membershipStatus: MembershipStatus;

  @ApiProperty({ type: [MyRoleDto] })
  roles: MyRoleDto[];

  @ApiProperty({
    example: ['workspace.read', 'members.invite'],
    type: [String],
    description:
      'Effective permissions in this workspace (union of the roles).',
  })
  permissions: string[];

  @ApiProperty({ type: WorkspacePlanDto, nullable: true })
  plan: WorkspacePlanDto | null;
}

export class MeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ana@example.com' })
  email: string;

  @ApiProperty({ example: 'Ana López' })
  displayName: string;

  @ApiProperty({ enum: UserStatus, enumName: 'UserStatus' })
  status: UserStatus;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty({
    description:
      'Temporary password: the user must change it (POST /auth/password/change) before using the app.',
  })
  mustChangePassword: boolean;

  @ApiProperty({ nullable: true, type: String })
  avatarUrl: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'es-MX' })
  locale: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'America/Mexico_City' })
  timezone: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  lastLoginAt: Date | null;

  @ApiProperty({ type: [MyWorkspaceDto] })
  workspaces: MyWorkspaceDto[];
}

export class UpdateMeDto {
  @ApiPropertyOptional({ example: 'Ana López', maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  displayName?: string;

  @ApiPropertyOptional({
    example: 'es-MX',
    nullable: true,
    description: 'BCP 47 language tag (e.g. "es", "es-MX"). null clears it.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Matches(/^[a-z]{2,3}(-[A-Z]{2})?$/, {
    message: 'locale must look like "es" or "es-MX"',
  })
  locale?: string | null;

  @ApiPropertyOptional({
    example: 'America/Mexico_City',
    nullable: true,
    description: 'IANA time zone. null clears it.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsIn(TIME_ZONES, { message: 'timezone must be a valid IANA time zone' })
  timezone?: string | null;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.png',
    nullable: true,
    description: 'HTTPS URL. null clears it.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Length(1, 2048)
  avatarUrl?: string | null;
}
