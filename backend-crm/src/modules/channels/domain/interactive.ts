/**
 * Interactive messages of the WhatsApp Cloud API that are free inside the
 * 24-hour customer-service window: reply buttons, a list of options and a
 * button that opens a URL. Limits are Meta's.
 */
export const INTERACTIVE_LIMITS = {
  body: 1024,
  header: 60,
  footer: 60,
  buttons: 3,
  buttonTitle: 20,
  listButton: 20,
  listRows: 10,
  listSections: 10,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  urlText: 20,
  url: 2000,
  /** A plain text message. */
  text: 4096,
  /** Reply ids WhatsApp sends back when the customer taps an option. */
  replyId: 256,
} as const;

export interface InteractiveOption {
  /** Sent back by WhatsApp when the customer chooses it. */
  id: string;
  title: string;
}

export interface InteractiveListRow extends InteractiveOption {
  description: string | null;
}

export interface InteractiveListSection {
  title: string | null;
  rows: InteractiveListRow[];
}

export interface InteractiveContent {
  kind: 'buttons' | 'list' | 'cta_url';
  header: string | null;
  body: string;
  footer: string | null;
  /** kind "buttons": up to 3 reply buttons. */
  buttons?: InteractiveOption[];
  /** kind "list": the button that opens the list and its sections. */
  list?: { button: string; sections: InteractiveListSection[] };
  /** kind "cta_url": a button that opens a link. */
  url?: { text: string; url: string };
}

/** The option a customer chose in a buttons or list message. */
export interface InteractiveReply {
  id: string;
  title: string;
}

type Json = Record<string, unknown>;

/** The `interactive` object of Graph API's POST /{phone-number-id}/messages. */
export function interactivePayload(content: InteractiveContent): Json {
  const common: Json = {
    ...(content.header && {
      header: { type: 'text', text: content.header },
    }),
    body: { text: content.body },
    ...(content.footer && { footer: { text: content.footer } }),
  };
  if (content.kind === 'buttons') {
    return {
      type: 'button',
      ...common,
      action: {
        buttons: (content.buttons ?? []).map((button) => ({
          type: 'reply',
          reply: { id: button.id, title: button.title },
        })),
      },
    };
  }
  if (content.kind === 'list') {
    const sections = content.list?.sections ?? [];
    return {
      type: 'list',
      ...common,
      action: {
        button: content.list?.button ?? '',
        sections: sections.map((section) => ({
          // Meta requires a title when there is more than one section.
          ...((section.title || sections.length > 1) && {
            title: section.title ?? 'Opciones',
          }),
          rows: section.rows.map((row) => ({
            id: row.id,
            title: row.title,
            ...(row.description && { description: row.description }),
          })),
        })),
      },
    };
  }
  return {
    type: 'cta_url',
    ...common,
    action: {
      name: 'cta_url',
      parameters: {
        display_text: content.url?.text ?? '',
        url: content.url?.url ?? '',
      },
    },
  };
}

/** Short text of an interactive message for previews (chat list, notifications). */
export function interactivePreview(content: InteractiveContent): string {
  return content.body;
}
