import {
  INTERACTIVE_LIMITS as LIMITS,
  type InteractiveContent,
} from '../../channels/domain/interactive';
import type { BotPause } from '../../inbox/domain/bot-pause';
import {
  isEmail,
  type BotMedia,
  type ConditionRule,
  type Flow,
  type FlowNode,
  type NodeOf,
} from './flow';
import { withinSchedule } from './schedule';
import {
  booleanValue,
  contactValues,
  isNumber,
  toNumber,
  type BotVariable,
  type VariableContact,
} from './variables';

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
      /** Sent after the handover; {{agente}} is left for whoever got the chat. */
      message: string | null;
      /** How long the chatbot stays off in the chat afterwards. */
      pause: BotPause;
    }
  | { kind: 'status'; status: 'OPEN' | 'ON_HOLD' | 'CLOSED' }
  /** "Guardar también en el contacto". */
  | { kind: 'contact'; field: 'name' | 'email'; value: string };

/** Where the conversation is in the flow. */
export interface EngineSession {
  /**
   * The node waiting for the customer's answer. null: the flow reached its
   * end; until the conversation restarts, messages get the fallback text.
   */
  nodeId: string | null;
  vars: Record<string, string>;
  attempts: number;
}

export interface EngineInput {
  /** What the customer wrote (or the title of the option they tapped). */
  text: string | null;
  /** Id of the option they tapped in buttons or a list. */
  replyId: string | null;
}

/** General settings of the chatbot that change how it answers. */
export interface EngineSettings {
  /** Sent when the customer writes something the flow does not expect. */
  fallbackText: string;
  /** Words that send the customer back to the greeting ("menu"). */
  restartKeywords: string[];
}

export interface EngineContext {
  now: Date;
  contact: VariableContact;
  settings?: EngineSettings;
  /** Variables created for the chatbot (types and default values). */
  variables?: BotVariable[];
}

export interface EngineResult {
  actions: BotAction[];
  /** null: the next message starts the flow again. */
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

/** Kept in transfer messages until the agent is known. */
export const AGENT = '{{agente}}';

/**
 * {{nombre}}, {{apellido}}, {{email}}, {{telefono}}… of the contact and the
 * chatbot's variables ({{variable}}) in texts. Unknown names read as ''.
 */
export function interpolate(
  text: string,
  vars: Record<string, string>,
  contact: VariableContact,
): string {
  const fromContact = contactValues(contact);
  return text.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_, name: string) => {
      const key = name.toLowerCase();
      return fromContact[key] ?? vars[name] ?? vars[key] ?? '';
    },
  );
}

const PHONE = /^\+?[\d\s()-]{6,20}$/;

/** The value to save from an answer, or null when it is not valid. */
function answerValue(
  node: NodeOf<'question'>,
  variable: BotVariable | undefined,
  text: string,
): string | null {
  const value = text.trim();
  if (!value) return null;
  // The type of the variable wins: a number is a number, sí/no is a boolean.
  if (variable?.type === 'boolean') return booleanValue(value);
  if (variable?.type === 'number' || node.data.validation === 'number')
    return isNumber(value) ? value.replace(',', '.') : null;
  switch (node.data.validation) {
    case 'email':
      return isEmail(value) ? value : null;
    case 'phone':
      return PHONE.test(value) ? value : null;
    default:
      return value.slice(0, 500);
  }
}

function ruleMatches(
  rule: ConditionRule,
  vars: Record<string, string>,
  lastText: string,
  contact: VariableContact,
): boolean {
  const raw =
    rule.source === 'variable'
      ? (contactValues(contact)[rule.variable.toLowerCase()] ??
        vars[rule.variable] ??
        vars[rule.variable.toLowerCase()] ??
        '')
      : lastText;
  const subject = normalize(raw);
  const value = normalize(rule.value);
  switch (rule.operator) {
    case 'equals':
      return subject === value;
    case 'contains':
      return value !== '' && subject.includes(value);
    case 'starts_with':
      return value !== '' && subject.startsWith(value);
    case 'is_number':
      return isNumber(subject);
    case 'is_empty':
      return subject === '';
    case 'greater_than':
    case 'less_than': {
      const left = toNumber(subject);
      const right = toNumber(value);
      if (left === null || right === null) return false;
      return rule.operator === 'greater_than' ? left > right : left < right;
    }
    case 'is_true':
      return booleanValue(subject) === 'true';
    case 'is_false':
      return booleanValue(subject) === 'false';
  }
}

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** What a new conversation starts with: the default value of each variable. */
export function initialVars(
  variables: BotVariable[] = [],
): Record<string, string> {
  return Object.fromEntries(
    variables.map((variable) => [variable.name, variable.defaultValue]),
  );
}

/**
 * Runs a chatbot flow for one customer message: from the start (no session),
 * from the node waiting for an answer, or after the end of the flow. Pure:
 * the caller sends the messages and applies the actions.
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
  const settings = context.settings;
  const actions: BotAction[] = [];
  const say = (message: BotMessage) => actions.push({ kind: 'send', message });
  const fill = (text: string, vars: Record<string, string>) =>
    interpolate(text, vars, context.contact);
  const sendFiles = (files: BotMedia[], caption: string | null = null) =>
    files.forEach((media, index) =>
      say({ kind: 'media', media, caption: index === 0 ? caption : null }),
    );

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
    // The flow simply runs out: still the same conversation, so what the
    // customer writes next gets the fallback text (or "menu" starts again).
    const ended = (): EngineSession => ({ nodeId: null, vars, attempts: 0 });
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
          const files = node.data.attachments;
          if (files.length === 1) {
            // One file carries the text as its caption, like WhatsApp.
            sendFiles(files, text ? cut(text, 1024) : null);
          } else {
            if (text) say({ kind: 'text', text: cut(text, LIMITS.text) });
            sendFiles(files);
          }
          cursor = next(node, 'next');
          break;
        }
        case 'buttons':
        case 'list':
          sendFiles(node.data.attachments);
          ask(node, vars);
          return { nodeId: node.id, vars, attempts: 0 };
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
            ruleMatches(candidate, vars, lastText, context.contact),
          );
          cursor = next(node, rule?.id ?? 'else');
          break;
        }
        case 'hours':
          // Sends nothing: it only chooses the way out (in or out of hours).
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
            message: node.data.message.trim()
              ? interpolate(
                  node.data.message,
                  { ...vars, agente: AGENT },
                  context.contact,
                )
              : null,
            pause: node.data.pause,
          });
          return null;
        case 'end':
          return null;
      }
    }
    return ended();
  };

  const start = flow.nodes.find((node) => node.type === 'start');
  const restart = () => ({
    actions,
    session: run(start?.id ?? null, initialVars(context.variables)),
  });

  // "menu" (or another word of the settings) goes back to the greeting.
  const typed = normalize(lastText);
  if (
    session &&
    !input.replyId &&
    typed &&
    settings?.restartKeywords.some((word) => normalize(word) === typed)
  )
    return restart();

  if (!session) return restart();

  // After the end of the flow: the fallback text, as nothing is expected.
  if (session.nodeId === null) {
    const text = fill(settings?.fallbackText ?? '', session.vars).trim();
    if (text) say({ kind: 'text', text: cut(text, LIMITS.text) });
    return { actions, session };
  }

  const waiting = byId.get(session.nodeId);
  if (
    !waiting ||
    (waiting.type !== 'buttons' &&
      waiting.type !== 'list' &&
      waiting.type !== 'question')
  )
    return restart();

  const vars = { ...session.vars };
  let handle: string | null = null;
  if (waiting.type === 'question') {
    const variable = context.variables?.find(
      (candidate) =>
        candidate.name.toLowerCase() === waiting.data.variable.toLowerCase(),
    );
    const value = answerValue(waiting, variable, lastText);
    if (value !== null) {
      vars[variable?.name ?? waiting.data.variable] = value;
      if (waiting.data.saveTo !== 'none')
        actions.push({
          kind: 'contact',
          field: waiting.data.saveTo,
          value: value.slice(0, 200),
        });
      handle = 'next';
    }
  } else {
    const choices =
      waiting.type === 'buttons'
        ? waiting.data.buttons
        : waiting.data.sections.flatMap((section) => section.rows);
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
  // one, otherwise the node's invalid-answer text and the question again (a
  // few times).
  const other = next(waiting, 'other');
  if (other) return { actions, session: run(other, vars) };
  const attempts = session.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) return { actions, session: null };
  say({
    kind: 'text',
    text:
      fill(waiting.data.invalidText, vars).trim() ||
      fill(settings?.fallbackText ?? '', vars).trim() ||
      DEFAULT_INVALID_TEXT,
  });
  ask(waiting, vars);
  return { actions, session: { nodeId: waiting.id, vars, attempts } };
}
