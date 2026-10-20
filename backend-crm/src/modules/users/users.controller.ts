import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../shared/http/error-response.dto';
import {
  ReqContext,
  type RequestContext,
} from '../../shared/http/request-context';
import { SWAGGER_BEARER } from '../../shared/http/swagger';
import type { AuthContext } from '../auth/application/auth.service';
import { CurrentUser } from '../auth/presentation/auth.decorators';
import { MeDto, UpdateMeDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'My profile, workspaces, roles and effective permissions',
  })
  @ApiOkResponse({ type: MeDto })
  getMe(@CurrentUser() auth: AuthContext): Promise<MeDto> {
    return this.users.getMe(auth.userId);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update my profile (name, locale, time zone, avatar)',
  })
  @ApiOkResponse({ type: MeDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  updateMe(
    @CurrentUser() auth: AuthContext,
    @Body() dto: UpdateMeDto,
    @ReqContext() context: RequestContext,
  ): Promise<MeDto> {
    return this.users.updateMe(auth.userId, dto, context);
  }
}
