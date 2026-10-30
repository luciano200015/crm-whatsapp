import { Injectable } from '@nestjs/common';

/**
 * How new chats find an agent («Configuración del módulo de chat»). A chat
 * nobody gets waits unassigned in «En espera» until someone accepts it.
 * - NONE: every new chat waits.
 * - LEAST_BUSY: to the agent of the line with the fewest open chats among
 *   those with the inbox open; nobody connected → it waits.
 * - CONTACT_AGENT: to the contact's regular agent; without one, it waits.
 */
export const ASSIGNMENT_MODES = [
  'NONE',
  'LEAST_BUSY',
  'CONTACT_AGENT',
] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

/** AGENT_CHOICE: the agent turns the signature on or off in the composer. */
export const SIGNATURE_MODES = ['AGENT_CHOICE', 'NEVER', 'ALWAYS'] as const;
export type SignatureMode = (typeof SIGNATURE_MODES)[number];

/** ASK: closing a chat asks the agent whether to send the message. */
export const CLOSE_MESSAGE_MODES = ['NEVER', 'ALWAYS', 'ASK'] as const;
export type CloseMessageMode = (typeof CLOSE_MESSAGE_MODES)[number];

export interface ChatSettings {
  assignment: {
    mode: AssignmentMode;
    /** Admins (conversations.view_all) get chats when no agent of the line is connected. */
    includeAdmins: boolean;
  };
  /** Agents transfer their own chats; off, only conversations.assign transfers. */
  transfers: boolean;
  signature: SignatureMode;
  closeMessage: { mode: CloseMessageMode; text: string };
}

/**
 * What the workspace saved. `assignment` is missing until someone saves the
 * settings: until then each line keeps its own switch and round-robin.
 */
export type StoredChatSettings = Partial<ChatSettings>;

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  assignment: { mode: 'NONE', includeAdmins: false },
  transfers: false,
  signature: 'AGENT_CHOICE',
  closeMessage: { mode: 'NEVER', text: '' },
};

/** Settings of the chat module per workspace (workspaces.settings.chat). */
export abstract class ChatSettingsStore {
  abstract get(workspaceId: string): Promise<StoredChatSettings>;
  abstract save(workspaceId: string, settings: ChatSettings): Promise<void>;
}

export interface ChatSettingsView extends ChatSettings {
  /** Not saved yet: lines still use their own auto-assignment switch. */
  legacyAssignment: boolean;
}

@Injectable()
export class ChatSettingsService {
  constructor(private readonly store: ChatSettingsStore) {}

  async get(workspaceId: string): Promise<ChatSettingsView> {
    const stored = await this.store.get(workspaceId);
    return {
      assignment: stored.assignment ?? DEFAULT_CHAT_SETTINGS.assignment,
      transfers: stored.transfers ?? DEFAULT_CHAT_SETTINGS.transfers,
      signature: stored.signature ?? DEFAULT_CHAT_SETTINGS.signature,
      closeMessage: stored.closeMessage ?? DEFAULT_CHAT_SETTINGS.closeMessage,
      legacyAssignment: !stored.assignment,
    };
  }

  async update(
    workspaceId: string,
    settings: ChatSettings,
  ): Promise<ChatSettingsView> {
    await this.store.save(workspaceId, {
      assignment: {
        mode: settings.assignment.mode,
        includeAdmins: settings.assignment.includeAdmins,
      },
      transfers: settings.transfers,
      signature: settings.signature,
      closeMessage: {
        mode: settings.closeMessage.mode,
        text: settings.closeMessage.text.trim(),
      },
    });
    return this.get(workspaceId);
  }
}

/** «*Ana Agente*:» on top of the text, as WhatsApp shows bold. */
export const signed = (name: string, text: string) => `*${name}*:\n${text}`;
