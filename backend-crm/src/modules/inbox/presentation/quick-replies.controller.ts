import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
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
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
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
import { MAX_MEDIA_BYTES } from '../application/media';
import {
  MAX_QUICK_REPLY_ATTACHMENTS,
  QuickRepliesService,
} from '../application/quick-replies';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateQuickReplyDto {
  @ApiPropertyOptional({
    example: 'Lavadoras monstruosas',
    description: 'What agents search for; unique per workspace.',
  })
  @ValidateIf((dto: CreateQuickReplyDto) => dto.shortcut === undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  title?: string;

  @ApiPropertyOptional({
    example: 'saludo',
    description:
      'Older clients: letters, numbers, "-" and "_" (up to 32), also used as title.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 33)
  shortcut?: string;

  @ApiPropertyOptional({
    type: [String],
    description: `Files uploaded with POST …/quick-replies/attachments (up to ${MAX_QUICK_REPLY_ATTACHMENTS}), sent after the text.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_QUICK_REPLY_ATTACHMENTS)
  @IsString({ each: true })
  attachmentIds?: string[];

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
  @Length(1, 80)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 33)
  shortcut?: string;

  @ApiPropertyOptional({ type: [String], description: 'Replaces the files.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_QUICK_REPLY_ATTACHMENTS)
  @IsString({ each: true })
  attachmentIds?: string[];

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

export class QuickReplyAttachmentDto {
  @ApiProperty()
  fileId: string;

  @ApiProperty({ example: 'lavadora-17kg.jpg' })
  filename: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType: string;

  @ApiProperty({ description: 'Bytes' })
  size: number;
}

export class QuickReplyDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Lavadoras monstruosas' })
  title: string;

  @ApiProperty({ example: 'lavadoras-monstruosas' })
  shortcut: string;

  @ApiProperty()
  text: string;

  @ApiProperty({ type: [QuickReplyAttachmentDto] })
  attachments: QuickReplyAttachmentDto[];

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

  @Post('attachments')
  @RequirePermissions('quick_replies.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_MEDIA_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload a file to attach to a quick reply',
    description:
      'Same types and sizes as sending a file in the chat (415 UNSUPPORTED_MEDIA_TYPE, 413 MEDIA_TOO_LARGE). Pass its fileId in attachmentIds.',
  })
  @ApiCreatedResponse({ type: QuickReplyAttachmentDto })
  upload(
    @CurrentWorkspace() workspace: WorkspaceAccess,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: 'Attach the file in the "file" field',
        code: 'FILE_REQUIRED',
      });
    }
    return this.replies.upload(workspace.workspaceId, {
      buffer: file.buffer,
      mimeType: file.mimetype,
      // Browsers send UTF-8 names; busboy (multer) decodes them as latin1.
      filename: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      size: file.size,
    });
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
