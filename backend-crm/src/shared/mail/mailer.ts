export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Port for outgoing email. Use cases depend on this, never on an SMTP library.
 * Messages may contain one-time tokens: implementations must not log bodies.
 */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}
