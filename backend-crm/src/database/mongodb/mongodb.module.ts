import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfigService } from '../../config/app-config.service';

/**
 * MongoDB connection for operational CRM data (contacts, conversations, messages).
 * Collection conventions (workspaceId on every document, workspace-scoped
 * indexes, cursor pagination) are defined in Phase 5.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.get('MONGODB_URI'),
        // Index builds are run by migrations/deploy tooling in production.
        autoIndex: !config.isProduction,
        serverSelectionTimeoutMS: 5_000,
      }),
    }),
  ],
})
export class MongoDbModule {}
