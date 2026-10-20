import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigService } from '../../config/app-config.service';
import { Clock, SystemClock } from '../../shared/time/clock';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/application/billing.service';
import { AuthService } from './application/auth.service';
import {
  AccessTokens,
  AuthStore,
  InitialSubscriptionProvider,
  PasswordHasher,
} from './application/ports';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { JwtAccessTokens } from './infrastructure/jwt-access-tokens';
import { PrismaAuthStore } from './infrastructure/prisma-auth-store';
import { AuthCookies } from './presentation/auth-cookies';
import { AuthController } from './presentation/auth.controller';
import { JwtAuthGuard } from './presentation/jwt-auth.guard';

@Module({
  imports: [
    BillingModule,
    // Keys and claims are passed per call in JwtAccessTokens.
    JwtModule.register({}),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          {
            ttl: config.get('AUTH_THROTTLE_TTL_SECONDS') * 1000,
            limit: config.get('AUTH_THROTTLE_LIMIT'),
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookies,
    { provide: AuthStore, useClass: PrismaAuthStore },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: AccessTokens, useClass: JwtAccessTokens },
    { provide: Clock, useClass: SystemClock },
    { provide: InitialSubscriptionProvider, useExisting: BillingService },
    // Secure by default: every route needs a token unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
