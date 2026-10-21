import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';
import { ErrorResponseDto } from '../../../shared/http/error-response.dto';
import { SWAGGER_BEARER } from '../../../shared/http/swagger';
import type { AuthContext } from '../../auth/application/auth.service';
import { CurrentUser } from '../../auth/presentation/auth.decorators';
import type { WorkspaceAccess } from '../../authorization/application/authorization.service';
import {
  CurrentWorkspace,
  RequirePermissions,
} from '../../authorization/presentation/workspace-access.decorators';
import { WorkspaceAccessGuard } from '../../authorization/presentation/workspace-access.guard';
import { AssignmentStore } from '../application/ports';
import { QuickRepliesService } from '../application/quick-replies';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateQuickReplyDto {
  @ApiProperty({
    example: 'saludo',
    description:
      'Typed after "/" in the chat. Letters, numbers, "-" and "_" (up to 32).',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 33)
  shortcut: string;

  @ApiProperty({
    example: '¡Hola! Gracias por escribirnos. ¿En qué te ayudamos?',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 4096)
  text: string;
}

export class UpdateQuickReplyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 33)
  shortcut?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 4096)
  text?: string;
}

class QuickReplyAuthorDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;
}

export class QuickReplyDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'saludo' })
  shortcut: string;

  @ApiProperty()
  text: string;

  @ApiProperty({ type: QuickReplyAuthorDto, nullable: true })
  createdBy: QuickReplyAuthorDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

@ApiTags('quick-replies')
@ApiBearerAuth(SWAGGER_BEARER)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@UseGuards(WorkspaceAccessGuard)
@Controller({ path: 'workspaces/:workspaceId/quick-replies', version: '1' })
export class QuickRepliesController {
  constructor(
    private readonly replies: QuickRepliesService,
    private readonly assignments: AssignmentStore,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Quick replies of the workspace',
    description: 'For members with messages.send or quick_replies.manage.',
  })
  @ApiOkResponse({ type: [QuickReplyDto] })
  list(@CurrentWorkspace() workspace: WorkspaceAccess) {
    return this.replies.list(workspace);
  }

  @Post()
  @RequirePermissions('quick_replies.manage')
  @ApiCreatedResponse({ type: QuickReplyDto })
  @ApiConflictResponse({
    description: 'QUICK_REPLY_SHORTCUT_TAKEN',
    type: ErrorResponseDto,
  })
  async create(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @CurrentUser() auth: AuthContext,
    @Body() dto: CreateQuickReplyDto,
  ) {
    const me = await this.assignments.activeMember(
      workspace.workspaceId,
      workspace.membershipId,
    );
    return this.replies.create(workspace.workspaceId, dto, {
      userId: auth.userId,
      name: me?.name ?? '',
    });
  }

  @Patch(':id')
  @RequirePermissions('quick_replies.manage')
  @ApiOkResponse({ type: QuickReplyDto })
  update(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('id') id: string,
    @Body() dto: UpdateQuickReplyDto,
  ) {
    return this.replies.update(workspace.workspaceId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('quick_replies.manage')
  @ApiNoContentResponse()
  async remove(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @Param('id') id: string,
  ): Promise<void> {
    await this.replies.remove(workspace.workspaceId, id);
  }
}
