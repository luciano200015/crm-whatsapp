import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfigService } from '../../config/app-config.service';

/**
 * MongoDB connection for operational CRM data (contacts, conversations, messages).
 * Conventions: every collection uses the workspaceScoped plugin (required
 * workspaceId, queries without it are refused), indexes start with
 * workspaceId, and lists use cursor pagination (pagination.ts).
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.get('MONGODB_URI'),
        // Each store creates its indexes explicitly on startup (awaited), so
        // unique indexes exist before the first request in every environment.
        autoIndex: false,
        serverSelectionTimeoutMS: 5_000,
      }),
    }),
  ],
})
export class MongoDbModule {}
