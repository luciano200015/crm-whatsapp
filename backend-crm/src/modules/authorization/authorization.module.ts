import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './application/authorization.service';
import { WorkspaceAccessGuard } from './presentation/workspace-access.guard';

@Global()
@Module({
  providers: [AuthorizationService, WorkspaceAccessGuard],
  exports: [AuthorizationService, WorkspaceAccessGuard],
})
export class AuthorizationModule {}
