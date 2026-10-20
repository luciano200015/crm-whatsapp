import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { MongoDbModule } from './database/mongodb/mongodb.module';
import { PrismaModule } from './database/postgres/prisma.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { BillingModule } from './modules/billing/billing.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { WhatsAppWebhookModule } from './modules/channels/whatsapp-webhook.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { TeamModule } from './modules/team/team.module';
import { UsersModule } from './modules/users/users.module';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { buildLoggerParams } from './shared/logging/logger.config';
import { MailModule } from './shared/mail/mail.module';
import { SecurityModule } from './shared/security/security.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: buildLoggerParams,
    }),
    PrismaModule,
    MongoDbModule,
    SecurityModule,
    MailModule,
    AuditModule,
    HealthModule,
    AuthorizationModule,
    AuthModule,
    UsersModule,
    BillingModule,
    TeamModule,
    ContactsModule,
    ChannelsModule,
    WhatsAppWebhookModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
