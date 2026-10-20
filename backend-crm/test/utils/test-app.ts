import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import type { Response } from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { AppConfigService } from '../../src/config/app-config.service';
import type { Env } from '../../src/config/env.schema';
import { Mailer, MailMessage } from '../../src/shared/mail/mailer';

/** Captures outgoing email instead of talking to SMTP. */
export class InMemoryMailer extends Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  last(to: string, subject?: string): MailMessage {
    const message = [...this.sent]
      .reverse()
      .find((m) => m.to === to && (!subject || m.subject === subject));
    if (!message) throw new Error(`No email to ${to} (${subject ?? 'any'})`);
    return message;
  }

  /** The plain token printed in the email body. */
  tokenIn(message: MailMessage): string {
    const match = /use this token in POST \S+: ([A-Za-z0-9_-]{20,})/.exec(
      message.text,
    );
    if (!match?.[1]) throw new Error('No token in email');
    return match[1];
  }
}

export interface TestApp {
  app: INestApplication<App>;
  mailer: InMemoryMailer;
  config: AppConfigService;
}

export async function createTestApp(
  overrides: Partial<Env> = {},
): Promise<TestApp> {
  const mailer = new InMemoryMailer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(AppConfigService)
    .useFactory({
      inject: [ConfigService],
      factory: (configService: ConfigService<Env, true>) => {
        const config = new AppConfigService(configService);
        const read = config.get.bind(config);
        config.get = <K extends keyof Env>(key: K): Env[K] =>
          key in overrides ? (overrides[key] as Env[K]) : read(key);
        return config;
      },
    })
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>({
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  return { app, mailer, config: app.get(AppConfigService) };
}

/** Value of a cookie set by the response, or undefined. */
export function cookieFrom(
  response: Response,
  name: string,
): string | undefined {
  return setCookieHeader(response, name)?.split(';')[0]?.split('=')[1];
}

/** The full Set-Cookie line for a cookie (to assert its attributes). */
export function setCookieHeader(
  response: Response,
  name: string,
): string | undefined {
  const raw = response.headers['set-cookie'] as unknown;
  const lines = Array.isArray(raw) ? (raw as string[]) : [];
  return lines.find((line) => line.startsWith(`${name}=`));
}
