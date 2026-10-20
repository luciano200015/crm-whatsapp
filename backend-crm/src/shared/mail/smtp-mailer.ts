import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';
import { Mailer, MailMessage } from './mailer';

/** SMTP adapter. In development it points at Mailpit (docker-compose). */
@Injectable()
export class SmtpMailer extends Mailer implements OnModuleDestroy {
  private readonly logger = new Logger(SmtpMailer.name);
  private transporter?: Promise<Transporter>;

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async send(message: MailMessage): Promise<void> {
    const transporter = await this.getTransporter();
    await transporter.sendMail({
      from: this.config.get('MAIL_FROM'),
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    // Recipient and body are deliberately not logged (PII, one-time tokens).
    this.logger.debug(`Email sent: "${message.subject}"`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.transporter) (await this.transporter).close();
  }

  private getTransporter(): Promise<Transporter> {
    // nodemailer >= 10 is ESM-only; a dynamic import keeps this module CommonJS.
    this.transporter ??= import('nodemailer').then((nodemailer) => {
      const user = this.config.get('SMTP_USER');
      const pass = this.config.get('SMTP_PASSWORD');
      return nodemailer.createTransport({
        host: this.config.get('SMTP_HOST'),
        port: this.config.get('SMTP_PORT'),
        secure: this.config.get('SMTP_SECURE'),
        auth: user ? { user, pass } : undefined,
      });
    });
    return this.transporter;
  }
}
