import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserStatus } from '../../../generated/prisma/client';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../domain/password-policy';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Hard cap on what reaches Argon2 (the policy itself allows up to 128 chars). */
const PASSWORD_INPUT_MAX = 256;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{20,128}$/;

const PASSWORD_DESCRIPTION = `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters. Passphrases are welcome; no symbol/digit rules. Must not be your email.`;

// ─────────────────────────── Requests ───────────────────────────

export class RegisterDto {
  @ApiProperty({ example: 'ana@example.com', maxLength: 320 })
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({
    example: 'correct horse battery staple',
    description: PASSWORD_DESCRIPTION,
    format: 'password',
  })
  @IsString()
  @MaxLength(PASSWORD_INPUT_MAX)
  password: string;

  @ApiProperty({ example: 'Ana López', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  displayName: string;

  @ApiPropertyOptional({
    example: 'Acme Corp',
    maxLength: 120,
    description:
      'Name of the first workspace. Defaults to "<displayName>\'s workspace".',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  workspaceName?: string;

  @ApiPropertyOptional({
    example: 'team',
    description:
      'Plan code from GET /billing/plans. Defaults to BILLING_DEFAULT_PLAN (the most basic plan). The trial (BILLING_TRIAL_DAYS) applies to this plan.',
  })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_-]{1,49}$/, {
    message: 'planCode has an invalid format',
  })
  planCode?: string;

  @ApiPropertyOptional({ enum: ['MONTH', 'YEAR'], example: 'MONTH' })
  @IsOptional()
  @IsIn(['MONTH', 'YEAR'])
  interval?: 'MONTH' | 'YEAR';
}

export class LoginDto {
  @ApiProperty({ example: 'ana@example.com' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ example: 'correct horse battery staple', format: 'password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_INPUT_MAX)
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ana@example.com' })
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email: string;
}

export class TokenDto {
  @ApiProperty({
    description:
      'One-time token received by email (see Mailpit at http://localhost:8025 in development).',
    example: 'q3Jw0b9c...',
  })
  @Transform(trim)
  @Matches(TOKEN_FORMAT, { message: 'token has an invalid format' })
  token: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ description: PASSWORD_DESCRIPTION, format: 'password' })
  @IsString()
  @MaxLength(PASSWORD_INPUT_MAX)
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty({ format: 'password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_INPUT_MAX)
  currentPassword: string;

  @ApiProperty({ description: PASSWORD_DESCRIPTION, format: 'password' })
  @IsString()
  @MaxLength(PASSWORD_INPUT_MAX)
  newPassword: string;
}

// ─────────────────────────── Responses ───────────────────────────

export class MessageResponseDto {
  @ApiProperty({ example: 'Check your inbox to continue.' })
  message: string;
}

export class AuthUserDto {
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
      'True when the account has a temporary password (created by a workspace admin). ' +
      'Every endpoint except POST /auth/password/change, GET /users/me and the session endpoints answers 403 PASSWORD_CHANGE_REQUIRED until it is changed.',
  })
  mustChangePassword: boolean;
}

export class AccessTokenResponseDto {
  @ApiProperty({
    description: 'ES256 JWT. Send as `Authorization: Bearer <token>`.',
  })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({
    example: 900,
    description: 'Seconds until the access token expires.',
  })
  expiresIn: number;
}

export class LoginResponseDto extends AccessTokenResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}

export class SessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ nullable: true, type: String, example: '127.0.0.1' })
  ipAddress: string | null;

  @ApiProperty({ nullable: true, type: String })
  userAgent: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  lastUsedAt: Date;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ description: 'True for the session making this request.' })
  current: boolean;
}

export class RevokedCountDto {
  @ApiProperty({ example: 2 })
  revoked: number;
}
