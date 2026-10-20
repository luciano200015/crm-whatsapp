import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      // Real environment variables win over .env (dotenv does not override).
      envFilePath: process.env.NODE_ENV === 'test' ? ['.env.test'] : ['.env'],
      cache: true,
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
