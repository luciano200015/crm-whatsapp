import type { MailMessage } from '../../../shared/mail/mailer';

/**
 * Email bodies. Tokens are included both as a link (for the future web app)
 * and in plain form so they can be pasted into Swagger during development.
 */
export const authEmails = {
  verifyEmail(
    to: string,
    webAppUrl: string,
    token: string,
    ttlHours: number,
  ): MailMessage {
    return {
      to,
      subject: 'Confirm your email address',
      text: [
        'Welcome! Confirm your email address by opening this link:',
        '',
        `${webAppUrl}/verify-email?token=${encodeURIComponent(token)}`,
        '',
        `Or use this token in POST /api/v1/auth/email/verify: ${token}`,
        '',
        `The link expires in ${ttlHours} hours. If you did not sign up, ignore this email.`,
      ].join('\n'),
    };
  },

  accountAlreadyExists(to: string, webAppUrl: string): MailMessage {
    return {
      to,
      subject: 'Someone tried to sign up with your email',
      text: [
        'Someone (possibly you) tried to create an account with this email address,',
        'but an account already exists.',
        '',
        `If it was you, sign in or reset your password at ${webAppUrl}/forgot-password.`,
        'If it was not you, you can ignore this email.',
      ].join('\n'),
    };
  },

  passwordReset(
    to: string,
    webAppUrl: string,
    token: string,
    ttlMinutes: number,
  ): MailMessage {
    return {
      to,
      subject: 'Reset your password',
      text: [
        'We received a request to reset your password. Open this link:',
        '',
        `${webAppUrl}/reset-password?token=${encodeURIComponent(token)}`,
        '',
        `Or use this token in POST /api/v1/auth/password/reset: ${token}`,
        '',
        `The link expires in ${ttlMinutes} minutes and works once.`,
        'If you did not request it, ignore this email: your password stays the same.',
      ].join('\n'),
    };
  },

  passwordChanged(to: string): MailMessage {
    return {
      to,
      subject: 'Your password was changed',
      text: [
        'The password of your account was just changed and your other sessions were signed out.',
        'If this was not you, reset your password immediately and contact support.',
      ].join('\n'),
    };
  },
};
