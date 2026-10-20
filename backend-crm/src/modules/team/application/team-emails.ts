import type { MailMessage } from '../../../shared/mail/mailer';

/**
 * Team email bodies. The temporary password is the only secret sent by
 * email: it is random per member and must be changed on first sign-in.
 */
export const teamEmails = {
  newMemberAccess(input: {
    to: string;
    displayName: string;
    workspaceName: string;
    invitedBy: string;
    temporaryPassword: string;
    webAppUrl: string;
  }): MailMessage {
    return {
      to: input.to,
      subject: `You have been added to ${input.workspaceName}`,
      text: [
        `Hi ${input.displayName},`,
        '',
        `${input.invitedBy} created an account for you in ${input.workspaceName}.`,
        '',
        `Sign in at ${input.webAppUrl}/login with:`,
        `  Email: ${input.to}`,
        `  Temporary password: ${input.temporaryPassword}`,
        '',
        'You will be asked to choose your own password right after signing in.',
        'If you did not expect this email, you can ignore it.',
      ].join('\n'),
    };
  },

  addedToWorkspace(input: {
    to: string;
    workspaceName: string;
    invitedBy: string;
    webAppUrl: string;
  }): MailMessage {
    return {
      to: input.to,
      subject: `You have been added to ${input.workspaceName}`,
      text: [
        `${input.invitedBy} added you to ${input.workspaceName}.`,
        '',
        `Sign in with your usual password at ${input.webAppUrl}/login and pick it in the workspace selector.`,
      ].join('\n'),
    };
  },

  accessReset(input: {
    to: string;
    workspaceName: string;
    temporaryPassword: string;
    webAppUrl: string;
  }): MailMessage {
    return {
      to: input.to,
      subject: `Your new temporary password for ${input.workspaceName}`,
      text: [
        `An administrator of ${input.workspaceName} sent you a new temporary password.`,
        'The previous one no longer works.',
        '',
        `Sign in at ${input.webAppUrl}/login with:`,
        `  Email: ${input.to}`,
        `  Temporary password: ${input.temporaryPassword}`,
        '',
        'You will be asked to choose your own password right after signing in.',
      ].join('\n'),
    };
  },
};
