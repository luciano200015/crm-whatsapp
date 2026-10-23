import {
  INTERACTIVE_LIMITS as LIMITS,
  type InteractiveContent,
} from '../../channels/domain/interactive';
import {
  isEmail,
  type BotMedia,
  type ConditionRule,
  type Flow,
  type FlowNode,
  type NodeOf,
} from './flow';
import { withinSchedule } from './schedule';

/** Nodes run per customer message at most: a loop in the flow stops here. */
export const MAX_STEPS = 25;
/** Answers that match no option before the chatbot gives up. */
export const MAX_ATTEMPTS = 3;

export const DEFAULT_INVALID_TEXT =
  'No entendí tu respuesta. Elige una de las opciones, por favor.';

/** What the chatbot sends. */
export type BotMessage =
  | { kind: 'text'; text: string }
  | { kind: 'interactive'; content: InteractiveContent }
  | { kind: 'media'; media: BotMedia; caption: string | null };

/** What the chatbot does, in order. */
export type BotAction =
  | { kind: 'send'; message: BotMessage }
  | { kind: 'tags'; add: string[]; remove: string[] }
  | {
      kind: 'transfer';
      to: 'auto' | 'unassigned' | 'member';
      membershipId: string | null;
    }
  | { kind: 'status'; status: 'OPEN' | 'ON_HOLD' | 'CLOSED' };

/** Where the conversation waits for the customer. */
export interface EngineSession {
  nodeId: string;
  vars: Record<string, string>;
  attempts: number;
}

export interface EngineInput {
  /** What the customer wrote (or the title of the option they tapped). */
  text: string | null;
  /** Id of the option they tapped in buttons or a list. */
  replyId: string | null;
}

export interface EngineContext {
  now: Date;
  contact: { name: string | null; phone: string };
}

export interface EngineResult {
  actions: BotAction[];
  /** null: the flow finished (the next message starts it again). */
  session: EngineSession | null;
}

/** Ids WhatsApp sends back for an option: unique across the flow. */
export const optionReplyId = (nodeId: string, optionId: string) =>
  `${nodeId}:${optionId}`;

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** {{nombre}}, {{telefono}} and saved answers ({{variable}}) in texts. */
export function interpolate(
  text: string,
  vars: Record<string, string>,
  contact: EngineContext['contact'],
): string {
  return text.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_, name: string) => {
      const key = name.toLowerCase();
      if (key === 'nombre') return contact.name ?? '';
      if (key === 'telefono') return contact.phone;
      return vars[name] ?? vars[key] ?? '';
    },
  );
}

const PHONE = /^\+?[\d\s()-]{6,20}$/;
const NUMBER = /^-?\d+([.,]\d+)?$/;

function validAnswer(
  validation: NodeOf<'question'>['data']['validation'],
  text: string,
): boolean {
  const value = text.trim();
  if (!value) return false;
  switch (validation) {
    case 'number':
      return NUMBER.test(value);
    case 'email':
      return isEmail(value);
    case 'phone':
      return PHONE.test(value);
    case 'any':
      return true;
  }
}

function ruleMatches(
  rule: ConditionRule,
  vars: Record<string, string>,
  lastText: string,
): boolean {
  const subject = normalize(
    rule.source === 'variable' ? (vars[rule.variable] ?? '') : lastText,
  );
  const value = normalize(rule.value);
  switch (rule.operator) {
    case 'equals':
      return subject === value;
    case 'contains':
      return value !== '' && subject.includes(value);
    case 'starts_with':
      return value !== '' && subject.startsWith(value);
    case 'is_number':
      return NUMBER.test(subject);
    case 'is_empty':
      return subject === '';
  }
}

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Runs a chatbot flow for one customer message: from the start (no session)
 * or from the node waiting for an answer. Pure: the caller sends the
 * messages and applies the actions.
 */
export function advance(
  flow: Flow,
  session: EngineSession | null,
  input: EngineInput,
  context: EngineContext,
): EngineResult {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const edges = new Map(
    flow.edges.map((edge) => [
      `${edge.source}:${edge.sourceHandle}`,
      edge.target,
    ]),
  );
  const next = (node: FlowNode, handle: string) =>
    edges.get(`${node.id}:${handle}`) ?? null;
  const lastText = input.text ?? '';
  const actions: BotAction[] = [];
  const say = (message: BotMessage) => actions.push({ kind: 'send', message });
  const fill = (text: string, vars: Record<string, string>) =>
    interpolate(text, vars, context.contact);

  /** The message of a node that waits for an answer. */
  const ask = (node: FlowNode, vars: Record<string, string>) => {
    if (node.type === 'question') {
      say({ kind: 'text', text: cut(fill(node.data.text, vars), LIMITS.text) });
    } else if (node.type === 'buttons') {
      say({
        kind: 'interactive',
        content: {
          kind: 'buttons',
          header: cut(fill(node.data.header, vars), LIMITS.header) || null,
          body: cut(fill(node.data.body, vars), LIMITS.body),
          footer: cut(fill(node.data.footer, vars), LIMITS.footer) || null,
          buttons: node.data.buttons.map((button) => ({
            id: optionReplyId(node.id, button.id),
            title: button.title,
          })),
        },
      });
    } else if (node.type === 'list') {
      say({
        kind: 'interactive',
        content: {
          kind: 'list',
          header: cut(fill(node.data.header, vars), LIMITS.header) || null,
          body: cut(fill(node.data.body, vars), LIMITS.body),
          footer: cut(fill(node.data.footer, vars), LIMITS.footer) || null,
          list: {
            button: node.data.button,
            sections: node.data.sections.map((section) => ({
              title: section.title || null,
              rows: section.rows.map((row) => ({
                id: optionReplyId(node.id, row.id),
                title: row.title,
                description: row.description || null,
              })),
            })),
          },
        },
      });
    }
  };

  const run = (
    from: string | null,
    vars: Record<string, string>,
  ): EngineSession | null => {
    let cursor = from;
    for (let steps = 0; cursor; steps++) {
      if (steps >= MAX_STEPS) return null;
      const node = byId.get(cursor);
      if (!node) return null;
      switch (node.type) {
        case 'start':
          cursor = next(node, 'next');
          break;
        case 'message': {
          const text = fill(node.data.text, vars).trim();
          if (node.data.media) {
            say({
              kind: 'media',
              media: node.data.media,
              caption: text ? cut(text, 1024) : null,
            });
          } else if (text) {
            say({ kind: 'text', text: cut(text, LIMITS.text) });
          }
          cursor = next(node, 'next');
          break;
        }
        case 'buttons':
        case 'list':
        case 'question':
          ask(node, vars);
          return { nodeId: node.id, vars, attempts: 0 };
        case 'url':
          say({
            kind: 'interactive',
            content: {
              kind: 'cta_url',
              header: cut(fill(node.data.header, vars), LIMITS.header) || null,
              body: cut(fill(node.data.body, vars), LIMITS.body),
              footer: cut(fill(node.data.footer, vars), LIMITS.footer) || null,
              url: { text: node.data.text, url: node.data.url },
            },
          });
          cursor = next(node, 'next');
          break;
        case 'condition': {
          const rule = node.data.rules.find((candidate) =>
            ruleMatches(candidate, vars, lastText),
          );
          cursor = next(node, rule?.id ?? 'else');
          break;
        }
        case 'hours':
          cursor = next(
            node,
            withinSchedule(node.data.schedule, context.now) ? 'in' : 'out',
          );
          break;
        case 'tags':
          actions.push({
            kind: 'tags',
            add: [...node.data.add],
            remove: [...node.data.remove],
          });
          cursor = next(node, 'next');
          break;
        case 'status':
          actions.push({ kind: 'status', status: node.data.status });
          if (node.data.status === 'CLOSED') return null;
          cursor = next(node, 'next');
          break;
        case 'transfer':
          actions.push({
            kind: 'transfer',
            to: node.data.to,
            membershipId: node.data.membershipId,
          });
          return null;
        case 'end':
          return null;
      }
    }
    return null;
  };

  const start = flow.nodes.find((node) => node.type === 'start');
  const waiting = session ? byId.get(session.nodeId) : undefined;
  if (
    !session ||
    !waiting ||
    (waiting.type !== 'buttons' &&
      waiting.type !== 'list' &&
      waiting.type !== 'question')
  ) {
    return { actions, session: run(start?.id ?? null, {}) };
  }

  const vars = { ...session.vars };
  let handle: string | null = null;
  if (waiting.type === 'question') {
    if (validAnswer(waiting.data.validation, lastText)) {
      vars[waiting.data.variable] = lastText.trim().slice(0, 500);
      handle = 'next';
    }
  } else {
    const choices =
      waiting.type === 'buttons'
        ? waiting.data.buttons
        : waiting.data.sections.flatMap((section) => section.rows);
    const typed = normalize(lastText);
    const position = /^\d{1,2}$/.test(typed) ? Number(typed) - 1 : -1;
    const chosen =
      choices.find(
        (choice) => input.replyId === optionReplyId(waiting.id, choice.id),
      ) ??
      choices.find((choice) => normalize(choice.title) === typed) ??
      // "1", "2"… also choose, as customers often answer that way.
      choices[position];
    handle = chosen?.id ?? null;
  }
  if (handle) return { actions, session: run(next(waiting, handle), vars) };

  // An answer that matches nothing: the "otra respuesta" branch if there is
  // one, otherwise ask again (a few times).
  const other = next(waiting, 'other');
  if (other) return { actions, session: run(other, vars) };
  const attempts = session.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) return { actions, session: null };
  say({
    kind: 'text',
    text: fill(waiting.data.invalidText, vars).trim() || DEFAULT_INVALID_TEXT,
  });
  ask(waiting, vars);
  return { actions, session: { nodeId: waiting.id, vars, attempts } };
}
