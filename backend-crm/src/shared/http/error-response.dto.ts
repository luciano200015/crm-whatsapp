import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Shape produced by AllExceptionsFilter, for Swagger documentation. */
export class ErrorResponseDto {
  @ApiProperty({ example: 401 })
  statusCode: number;

  @ApiProperty({ example: 'Unauthorized' })
  error: string;

  @ApiProperty({
    oneOf: [
      { type: 'string', example: 'Invalid email or password' },
      { type: 'array', items: { type: 'string' } },
    ],
  })
  message: string | string[];

  @ApiPropertyOptional({
    example: 'PLAN_LIMIT_EXCEEDED',
    description: 'Stable code for errors that clients handle specifically.',
  })
  code?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { feature: 'limits.agents', plan: 'Equipo', limit: 3, usage: 4 },
  })
  details?: Record<string, unknown>;

  @ApiPropertyOptional({ example: '0a6c8b1e-5d1f-4c7a-9a1b-3f2e4d5c6b7a' })
  requestId?: string;

  @ApiProperty({ example: '2026-10-19T20:11:50.435Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/auth/login' })
  path: string;
}
