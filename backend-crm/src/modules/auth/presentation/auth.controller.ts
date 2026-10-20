import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ErrorResponseDto } from '../../../shared/http/error-response.dto';
import {
  ReqContext,
  type RequestContext,
} from '../../../shared/http/request-context';
import {
  SWAGGER_BEARER,
  SWAGGER_CSRF,
  SWAGGER_REFRESH_COOKIE,
} from '../../../shared/http/swagger';
import { type AuthContext, AuthService } from '../application/auth.service';
import { AuthCookies, REFRESH_COOKIE } from './auth-cookies';
import {
  AllowPendingPasswordChange,
  CurrentUser,
  Public,
} from './auth.decorators';
import {
  AccessTokenResponseDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LoginResponseDto,
  MessageResponseDto,
  RegisterDto,
  ResetPasswordDto,
  RevokedCountDto,
  SessionDto,
  TokenDto,
} from './auth.dto';
import { CsrfGuard } from './csrf.guard';

const GENERIC_REGISTER_MESSAGE =
  'If this email can be used, a confirmation email is on its way. You can sign in once you receive it.';
const GENERIC_FORGOT_MESSAGE =
  'If an account exists for this email, a password reset link has been sent.';

@ApiTags('auth')
@ApiTooManyRequestsResponse({
  description: 'Rate limit exceeded for this IP.',
  type: ErrorResponseDto,
})
@UseGuards(ThrottlerGuard)
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  // ─────────────────────────── Public ───────────────────────────

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Create an account and its first workspace',
    description:
      'Creates the user (status PENDING_VERIFICATION), a workspace and an OWNER membership in one transaction, then emails a verification token. ' +
      'The response is identical whether or not the email is already registered (no account enumeration). In development, open Mailpit at http://localhost:8025 to read the email.',
  })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid input or password policy violation.',
    type: ErrorResponseDto,
  })
  async register(
    @Body() dto: RegisterDto,
    @ReqContext() context: RequestContext,
  ): Promise<MessageResponseDto> {
    await this.auth.register(dto, context);
    return { message: GENERIC_REGISTER_MESSAGE };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      'Returns a short-lived access token and sets two cookies: `crm_rt` (HttpOnly refresh token, path /api/v1/auth) and `crm_csrf` (CSRF token). ' +
      'In Swagger UI the access token is applied to "Authorize" automatically. After 5 wrong passwords the account is locked for 15 minutes; every failure returns the same generic message.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Invalid email or password (always the same message).',
    type: ErrorResponseDto,
  })
  async login(
    @Body() dto: LoginDto,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.login(dto.email, dto.password, context);
    this.cookies.setSession(
      response,
      result.refreshToken,
      result.refreshExpiresAt,
    );
    const {
      id,
      email,
      displayName,
      status,
      emailVerifiedAt,
      mustChangePassword,
    } = result.user;
    return {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: result.expiresIn,
      user: {
        id,
        email,
        displayName,
        status,
        emailVerified: emailVerifiedAt !== null,
        mustChangePassword,
      },
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiCookieAuth(SWAGGER_REFRESH_COOKIE)
  @ApiSecurity(SWAGGER_CSRF)
  @ApiOperation({
    summary: 'Rotate the refresh token and get a new access token',
    description:
      'Uses the `crm_rt` cookie and requires the `X-CSRF-Token` header to match the `crm_csrf` cookie (Swagger UI adds it for you). ' +
      'Each refresh token works once; reusing an old one revokes the whole session.',
  })
  @ApiOkResponse({ type: AccessTokenResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, revoked or reused refresh token.',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Missing or invalid CSRF token.',
    type: ErrorResponseDto,
  })
  async refresh(
    @Req() request: Request,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponseDto> {
    try {
      const tokens = await this.auth.refresh(refreshCookie(request), context);
      this.cookies.setSession(
        response,
        tokens.refreshToken,
        tokens.refreshExpiresAt,
      );
      return {
        accessToken: tokens.accessToken,
        tokenType: 'Bearer',
        expiresIn: tokens.expiresIn,
      };
    } catch (error: unknown) {
      this.cookies.clear(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CsrfGuard)
  @ApiCookieAuth(SWAGGER_REFRESH_COOKIE)
  @ApiSecurity(SWAGGER_CSRF)
  @ApiOperation({
    summary: 'Sign out of the current session',
    description:
      'Revokes the session behind the `crm_rt` cookie (its access tokens stop working immediately) and clears the cookies. Idempotent.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({
    description: 'Missing or invalid CSRF token.',
    type: ErrorResponseDto,
  })
  async logout(
    @Req() request: Request,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(refreshCookie(request), context);
    this.cookies.clear(response);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Always answers the same way, whether or not the account exists. The emailed token expires in 30 minutes and works once.',
  })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @ReqContext() context: RequestContext,
  ): Promise<MessageResponseDto> {
    await this.auth.requestPasswordReset(dto.email, context);
    return { message: GENERIC_FORGOT_MESSAGE };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password with a reset token',
    description:
      'Consumes the token and signs out every session of the account.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'Invalid/expired/used token or password policy violation.',
    type: ErrorResponseDto,
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.newPassword, context);
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Confirm the email address with the emailed token',
    description:
      'Marks the email as verified and activates a PENDING_VERIFICATION account.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'Invalid, expired or used token.',
    type: ErrorResponseDto,
  })
  async verifyEmail(
    @Body() dto: TokenDto,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.auth.verifyEmail(dto.token, context);
  }

  // ─────────────────────────── Authenticated ───────────────────────────

  @Post('email/resend-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(SWAGGER_BEARER)
  @ApiOperation({
    summary: 'Send a new verification email (no-op if already verified)',
  })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async resendVerification(
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.auth.resendVerification(auth, context);
  }

  @AllowPendingPasswordChange()
  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(SWAGGER_BEARER)
  @ApiOperation({
    summary: 'Change the password while signed in',
    description:
      'Requires the current password. Signs out every other session; the current one stays.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'Wrong current password or policy violation.',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async changePassword(
    @CurrentUser() auth: AuthContext,
    @Body() dto: ChangePasswordDto,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.auth.changePassword(
      auth,
      dto.currentPassword,
      dto.newPassword,
      context,
    );
  }

  @AllowPendingPasswordChange()
  @Get('sessions')
  @ApiBearerAuth(SWAGGER_BEARER)
  @ApiOperation({ summary: 'List my active sessions (devices)' })
  @ApiOkResponse({ type: [SessionDto] })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  listSessions(@CurrentUser() auth: AuthContext): Promise<SessionDto[]> {
    return this.auth.listSessions(auth);
  }

  @AllowPendingPasswordChange()
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(SWAGGER_BEARER)
  @ApiOperation({
    summary: 'Sign out one of my sessions',
    description:
      'Only your own sessions can be revoked; anything else answers 404.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async revokeSession(
    @CurrentUser() auth: AuthContext,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.auth.revokeSession(auth, sessionId, context);
  }

  @AllowPendingPasswordChange()
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth(SWAGGER_BEARER)
  @ApiOperation({ summary: 'Sign out every session except the current one' })
  @ApiOkResponse({ type: RevokedCountDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async revokeOtherSessions(
    @CurrentUser() auth: AuthContext,
    @ReqContext() context: RequestContext,
  ): Promise<RevokedCountDto> {
    return { revoked: await this.auth.revokeOtherSessions(auth, context) };
  }
}

function refreshCookie(request: Request): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
