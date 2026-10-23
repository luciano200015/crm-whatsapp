/** A chatbot as stored (PostgreSQL). `graph` and `schedule` are JSON. */
export interface ChatbotRecord {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  graph: unknown;
  schedule: unknown;
  restartAfterMinutes: number;
  /** Lines this chatbot answers on. */
  lines: { id: string; name: string }[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatbotChanges {
  name?: string;
  enabled?: boolean;
  graph?: unknown;
  /** null: always available. */
  schedule?: unknown;
  restartAfterMinutes?: number;
}

export type SetLinesResult =
  | ChatbotRecord
  | { kind: 'chatbot_not_found' }
  | { kind: 'line_not_found' }
  /** The line answers with another chatbot (only one per line). */
  | { kind: 'line_taken'; lineId: string; lineName: string; chatbot: string };

/** Persistence of chatbots and of which line each one answers. */
export abstract class ChatbotsStore {
  abstract list(workspaceId: string): Promise<ChatbotRecord[]>;
  abstract find(
    workspaceId: string,
    chatbotId: string,
  ): Promise<ChatbotRecord | null>;
  abstract create(
    workspaceId: string,
    input: { name: string; graph: unknown; createdByUserId: string | null },
  ): Promise<ChatbotRecord>;
  abstract update(
    workspaceId: string,
    chatbotId: string,
    changes: ChatbotChanges,
  ): Promise<ChatbotRecord | null>;
  abstract remove(workspaceId: string, chatbotId: string): Promise<boolean>;
  /**
   * Replaces the lines of a chatbot. Lines of another chatbot are moved
   * only with `takeOver`.
   */
  abstract setLines(
    workspaceId: string,
    chatbotId: string,
    lineIds: string[],
    takeOver: boolean,
  ): Promise<SetLinesResult>;
}
