import {
  INTERACTIVE_LIMITS as LIMITS,
  type InteractiveContent,
} from '../../channels/domain/interactive';
import {
  INVALID,
  parseFieldValue,
  type FieldDefinition,
} from '../../contacts/domain/contact-fields';
import type { BotPause } from '../../inbox/domain/bot-pause';
import {
  buildRequest,
  valueAt,
  type BotRequest,
  type BotResponse,
} from './bot-request';
import {
  acceptsAny,
  hasOptions,
  isEmail,
  matchesTrigger,
  waitsForAnswer,
  type BotMedia,
  type ConditionRule,
  type Flow,
  type FlowNode,
  type FlowReplyOption,
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

/**
 * Options the chatbot adds on its own (the "@" keeps them apart from the
 * flow's options): show the waiting node again, or go back to the greeting.
 */
export const SHOW_AGAIN = '@menu';
export const FROM_START = '@start';
export const BOT_BUTTONS = {
  showAgain: 'Ver menú',
  fromStart: 'Volver al inicio',
  resume: 'Continuar',
} as const;

export const DEFAULT_INVALID_TEXT =
  'No entendí tu respuesta. Elige una de las opciones, por favor.';
/** Said when a «Guardar respuesta» without a question gets an invalid answer. */
export const DEFAULT_INVALID_ANSWER =
  'Esa respuesta no es válida. Inténtalo de nuevo, por favor.';
/** The button that opens a list when the «Respuesta» names none. */
export const DEFAULT_LIST_BUTTON = 'Ver opciones';
/** «Consulta API» calls per customer message at most. */
export const MAX_REQUESTS = 5;

/** What the chatbot sends. */
export type BotMessage =
  | { kind: 'text'; text: string }
  | { kind: 'interactive'; content: InteractiveContent }
  | { kind: 'media'; media: BotMedia; caption: string | null }
  | {
      kind: 'location';
      location: {
        latitude: number;
        longitude: number;
        name: string | null;
        address: string | null;
      };
    }
  | { kind: 'contacts'; contacts: { name: string; phone: string }[] };

/** What the chatbot does, in order. */
export type BotAction =
  | { kind: 'send'; message: BotMessage }
  | { kind: 'tags'; add: string[]; remove: string[] }
  | { kind: 'funnel'; funnelId: string; stageId: string }
  | {
      kind: 'transfer';
      to: 'auto' | 'unassigned' | 'member';
      membershipId: string | null;
      /** Sent after the handover; {{agente}} is left for whoever got the chat. */
      message: string | null;
      /** How long the chatbot stays off in the chat afterwards. */
      pause: BotPause;
      /** «Mensaje para el agente»: an internal note (null none). */
      note: string | null;
    }
  | { kind: 'status'; status: 'OPEN' | 'ON_HOLD' | 'CLOSED' }
  /** «Desactivar bot»: the chatbot stops answering this chat. */
  | { kind: 'pause' }
  /**
   * "Guardar también en el contacto" and «Actualizar campo de contacto»:
   * name, email or the key of a custom field (already validated).
   */
  | { kind: 'contact'; field: string; value: string };

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
  /**
   * The answer to the request of the «Consulta API» the session stopped at:
   * the flow goes on from there (ok or error).
   */
  response?: BotResponse;
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
  /** Custom fields of contacts, for «Actualizar campo de contacto». */
  contactFields?: FieldDefinition[];
}

export interface EngineResult {
  actions: BotAction[];
  /** null: the next message starts the flow again. */
  session: EngineSession | null;
  /**
   * A «Consulta API» to call: the session stopped at its node and the
   * caller runs `advance` again with the response.
   */
  request?: BotRequest;
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
  /** Applied to each value (URL-encoding in a «Consulta API»). */
  encode: (value: string) => string = (value) => value,
): string {
  const fromContact = contactValues(contact);
  return text.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_, name: string) => {
      const key = name.toLowerCase();
      return encode(fromContact[key] ?? vars[name] ?? vars[key] ?? '');
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
  const among = () =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .includes(subject);
  switch (rule.operator) {
    case 'equals':
      return subject === value;
    case 'not_equals':
      return subject !== value;
    case 'contains':
      return value !== '' && subject.includes(value);
    case 'not_contains':
      return value === '' || !subject.includes(value);
    case 'starts_with':
      return value !== '' && subject.startsWith(value);
    case 'is_number':
      return isNumber(subject);
    case 'is_not_number':
      return !isNumber(subject);
    case 'is_empty':
      return subject === '';
    case 'is_not_empty':
      return subject !== '';
    case 'in':
      return among();
    case 'not_in':
      return !among();
    case 'greater_than':
    case 'gte':
    case 'less_than':
    case 'lte': {
      const left = toNumber(subject);
      const right = toNumber(value);
      if (left === null || right === null) return false;
      if (rule.operator === 'greater_than') return left > right;
      if (rule.operator === 'gte') return left >= right;
      if (rule.operator === 'less_than') return left < right;
      return left <= right;
    }
    case 'is_true':
      return booleanValue(subject) === 'true';
    case 'is_false':
      return booleanValue(subject) === 'false';
  }
}

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** A text with the chatbot's own buttons. */
const withButtons = (
  text: string,
  buttons: { id: string; title: string }[],
): BotMessage => ({
  kind: 'interactive',
  content: {
    kind: 'buttons',
    header: null,
    body: cut(text, LIMITS.body),
    footer: null,
    buttons,
  },
});

/**
 * "¿Quieres que avancemos?" after a while without an answer, with a button
 * that shows the waiting node again.
 */
export const nudgeMessage = (text: string, nodeId: string): BotMessage =>
  withButtons(text, [
    { id: optionReplyId(nodeId, SHOW_AGAIN), title: BOT_BUTTONS.resume },
  ]);

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
  const targets = new Set(flow.edges.map((edge) => edge.target));
  /**
   * The card connected to a waiting message whose words were written; a
   * card that takes any message («*») only when no other matches.
   */
  const answered = (node: FlowNode, text: string) => {
    const children = flow.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => byId.get(edge.target))
      .filter((child): child is FlowNode => child !== undefined);
    return (
      children.find((child) => matchesTrigger(child.trigger, text)) ??
      (text.trim()
        ? children.find((child) => acceptsAny(child.trigger))
        : undefined) ??
      null
    );
  };
  /** A card nothing connects to, opened by its words at any moment. */
  const entry = (text: string) =>
    flow.nodes.find(
      (node) =>
        node.type !== 'start' &&
        !targets.has(node.id) &&
        matchesTrigger(node.trigger, text),
    ) ?? null;
  const lastText = input.text ?? '';
  const settings = context.settings;
  const actions: BotAction[] = [];
  let request: BotRequest | undefined;
  const say = (message: BotMessage) => actions.push({ kind: 'send', message });
  const fill = (text: string, vars: Record<string, string>) =>
    interpolate(text, vars, context.contact);
  const sendFiles = (files: BotMedia[], caption: string | null = null) =>
    files.forEach((media, index) =>
      say({ kind: 'media', media, caption: index === 0 ? caption : null }),
    );
  const done = (result: EngineSession | null): EngineResult => ({
    actions,
    session: result,
    ...(request && { request }),
  });

  /**
   * The options of a «Respuesta»: reply buttons (a single image, video or
   * document as their header) or a list (see sentAsButtons). Other files
   * go before.
   */
  const sendOptions = (
    node: NodeOf<'message'>,
    vars: Record<string, string>,
  ) => {
    const { options, attachments } = node.data;
    const asButtons = sentAsButtons(node.data.options);
    const single = attachments.length === 1 ? attachments[0] : undefined;
    const headerMedia =
      asButtons && single && single.type !== 'audio' ? single : null;
    if (!headerMedia) sendFiles(attachments);
    const common = {
      header: headerMedia
        ? null
        : cut(fill(node.data.header, vars), LIMITS.header) || null,
      body: cut(fill(node.data.text, vars), LIMITS.body),
      footer: cut(fill(node.data.footer, vars), LIMITS.footer) || null,
    };
    say({
      kind: 'interactive',
      content: asButtons
        ? {
            kind: 'buttons',
            ...common,
            ...(headerMedia && { headerMedia: mediaHeader(headerMedia) }),
            buttons: options.map((option) => ({
              id: optionReplyId(node.id, option.id),
              title: option.title,
            })),
          }
        : {
            kind: 'list',
            ...common,
            list: {
              button: node.data.listButton.trim() || DEFAULT_LIST_BUTTON,
              sections: [
                {
                  title: null,
                  rows: options.map((option) => ({
                    id: optionReplyId(node.id, option.id),
                    title: option.title,
                    description: option.description || null,
                  })),
                },
              ],
            },
          },
    });
  };

  /** The message of a node that waits for an answer. */
  const ask = (node: FlowNode, vars: Record<string, string>) => {
    if (node.type === 'question' && node.data.text.trim()) {
      say({ kind: 'text', text: cut(fill(node.data.text, vars), LIMITS.text) });
    } else if (node.type === 'message' && hasOptions(node)) {
      sendOptions(node, vars);
    }
  };

  /** Saves an answer of a «Guardar respuesta»; false when it is not valid. */
  const save = (
    node: NodeOf<'question'>,
    vars: Record<string, string>,
    text: string,
  ): boolean => {
    const variable = context.variables?.find(
      (candidate) =>
        candidate.name.toLowerCase() === node.data.variable.toLowerCase(),
    );
    const value = answerValue(node, variable, text);
    if (value === null) return false;
    vars[variable?.name ?? node.data.variable] = value;
    if (node.data.saveTo !== 'none')
      actions.push({
        kind: 'contact',
        field: node.data.saveTo,
        value: value.slice(0, 200),
      });
    return true;
  };

  /** «Actualizar campo de contacto»: the value when it fits the field. */
  const fieldValue = (
    node: NodeOf<'contact_field'>,
    vars: Record<string, string>,
  ): string | null => {
    const raw = (
      node.data.source === 'answer' ? lastText : fill(node.data.value, vars)
    ).trim();
    if (!raw) return null;
    if (node.data.field === 'name') return raw.slice(0, 120);
    if (node.data.field === 'email') return isEmail(raw) ? raw : null;
    const field = context.contactFields?.find(
      (candidate) => candidate.key === node.data.field,
    );
    if (!field) return null;
    const value = parseFieldValue(field, raw);
    return value === null || value === INVALID ? null : String(value);
  };

  const run = (
    from: string | null,
    vars: Record<string, string>,
  ): EngineSession | null => {
    // The flow simply runs out: still the same conversation, so what the
    // customer writes next gets the fallback text (or "menu" starts again).
    const ended = (): EngineSession => ({ nodeId: null, vars, attempts: 0 });
    const waitHere = (node: FlowNode): EngineSession => ({
      nodeId: node.id,
      vars,
      attempts: 0,
    });
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
          if (hasOptions(node)) {
            sendOptions(node, vars);
            return waitHere(node);
          }
          const text = fill(node.data.text, vars).trim();
          const files = node.data.attachments;
          if (files.length === 1) {
            // One file carries the text as its caption, like WhatsApp.
            sendFiles(files, text ? cut(text, 1024) : null);
          } else {
            if (text) say({ kind: 'text', text: cut(text, LIMITS.text) });
            sendFiles(files);
          }
          if (waitsForAnswer(node)) return waitHere(node);
          cursor = next(node, 'next');
          break;
        }
        case 'question': {
          if (node.data.text.trim()) {
            ask(node, vars);
            return waitHere(node);
          }
          // No question: it saves the message that opened the card.
          if (save(node, vars, lastText)) {
            cursor = next(node, 'next');
            break;
          }
          const other = next(node, 'other');
          if (other) {
            cursor = other;
            break;
          }
          say({
            kind: 'text',
            text: cut(
              fill(node.data.invalidText, vars).trim() ||
                DEFAULT_INVALID_ANSWER,
              LIMITS.text,
            ),
          });
          return waitHere(node);
        }
        case 'url': {
          const media = node.data.attachment;
          say({
            kind: 'interactive',
            content: {
              kind: 'cta_url',
              header: media
                ? null
                : cut(fill(node.data.header, vars), LIMITS.header) || null,
              ...(media && { headerMedia: mediaHeader(media) }),
              body: cut(fill(node.data.body, vars), LIMITS.body),
              footer: cut(fill(node.data.footer, vars), LIMITS.footer) || null,
              url: { text: node.data.text, url: node.data.url },
            },
          });
          if (waitsForAnswer(node)) return waitHere(node);
          cursor = next(node, 'next');
          break;
        }
        case 'location': {
          const { latitude, longitude } = node.data;
          if (latitude !== null && longitude !== null)
            say({
              kind: 'location',
              location: {
                latitude,
                longitude,
                name: cut(fill(node.data.name, vars), 100) || null,
                address: cut(fill(node.data.address, vars), 100) || null,
              },
            });
          cursor = next(node, 'next');
          break;
        }
        case 'contact_card': {
          const contacts = node.data.contacts
            .map((card) => ({
              name: cut(fill(card.name, vars).trim(), 80),
              phone: card.phone,
            }))
            .filter((card) => card.name && card.phone);
          if (contacts.length > 0) say({ kind: 'contacts', contacts });
          cursor = next(node, 'next');
          break;
        }
        case 'contact_field': {
          const value = fieldValue(node, vars);
          if (value !== null)
            actions.push({ kind: 'contact', field: node.data.field, value });
          cursor = next(node, value === null ? 'fail' : 'ok');
          break;
        }
        case 'api':
          // Stops here: the caller calls the service and comes back with
          // its response.
          request = buildRequest(node.data, (text, encode) =>
            interpolate(text, vars, context.contact, encode),
          );
          return waitHere(node);
        case 'condition': {
          const matches = (rule: ConditionRule) =>
            ruleMatches(rule, vars, lastText, context.contact);
          const { rules, match } = node.data;
          if (match === 'each') {
            cursor = next(node, rules.find(matches)?.id ?? 'else');
          } else {
            const met =
              rules.length > 0 &&
              (match === 'all' ? rules.every(matches) : rules.some(matches));
            cursor = next(node, met ? 'yes' : 'no');
          }
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
        case 'funnel':
          actions.push({
            kind: 'funnel',
            funnelId: node.data.funnelId,
            stageId: node.data.stageId,
          });
          cursor = next(node, 'next');
          break;
        case 'status':
          actions.push({ kind: 'status', status: node.data.status });
          if (node.data.bot === 'pause') {
            actions.push({ kind: 'pause' });
            return null;
          }
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
            note: fill(node.data.note, vars).trim().slice(0, 1024) || null,
          });
          return null;
        case 'end':
          return null;
      }
    }
    return ended();
  };

  // The answer of the «Consulta API» the flow stopped at.
  if (input.response) {
    const waiting = session?.nodeId ? byId.get(session.nodeId) : undefined;
    if (!session || waiting?.type !== 'api') return done(session);
    const vars = { ...session.vars };
    const { response } = input;
    if (response.ok)
      for (const item of waiting.data.responses)
        vars[item.variable] = valueAt(response.body, item.path);
    return done(run(next(waiting, response.ok ? 'ok' : 'error'), vars));
  }

  const start = flow.nodes.find((node) => node.type === 'start');
  const restart = () =>
    done(run(start?.id ?? null, initialVars(context.variables)));
  const fromStart = start
    ? [
        {
          id: optionReplyId(start.id, FROM_START),
          title: BOT_BUTTONS.fromStart,
        },
      ]
    : [];

  // The first node that waits for an answer: "Volver al inicio" from there
  // would only show it again.
  let home = start ? next(start, 'next') : null;
  for (let steps = 0; home && steps < MAX_STEPS; steps++) {
    const node = byId.get(home);
    if (
      !node ||
      waitsForAnswer(node) ||
      hasOptions(node) ||
      (node.type !== 'message' &&
        node.type !== 'url' &&
        node.type !== 'tags' &&
        node.type !== 'funnel' &&
        node.type !== 'location' &&
        node.type !== 'contact_card')
    )
      break;
    home = next(node, 'next');
  }

  /**
   * An answer the node cannot take: its invalid-answer text with buttons to
   * see the options again or go back to the greeting, so the customer is
   * never stuck in a loop of errors.
   */
  const sorry = (
    node: FlowNode,
    text: string,
    vars: Record<string, string>,
  ) => {
    const buttons = [
      ...(node.type === 'question'
        ? []
        : [
            {
              id: optionReplyId(node.id, SHOW_AGAIN),
              title: BOT_BUTTONS.showAgain,
            },
          ]),
      ...(node.id === home ? [] : fromStart),
    ];
    if (buttons.length > 0) {
      say(withButtons(text, buttons));
    } else {
      // A question at the very beginning: it is simply asked again.
      say({ kind: 'text', text: cut(text, LIMITS.text) });
      ask(node, vars);
    }
  };

  /** Nodes that wait for the customer: an option, an answer or words. */
  const waitsHere = (node: FlowNode) =>
    hasOptions(node) || node.type === 'question' || waitsForAnswer(node);

  // A tapped option is followed even from an older message (the customer
  // scrolled up to a menu sent before) or after the flow ended.
  const [repliedNode, repliedOption] = input.replyId?.split(':') ?? [];
  const replied = repliedNode ? byId.get(repliedNode) : undefined;
  if (replied && repliedOption) {
    const vars = session ? { ...session.vars } : initialVars(context.variables);
    if (repliedOption === FROM_START && replied.type === 'start')
      return restart();
    if (repliedOption === SHOW_AGAIN && waitsHere(replied))
      return done(run(replied.id, vars));
    if (
      replied.type === 'message' &&
      replied.data.options.some((option) => option.id === repliedOption)
    )
      return done(run(next(replied, repliedOption), vars));
  }

  // "menu" (or another word of the settings) goes back to the greeting.
  const typed = normalize(lastText);
  if (
    session &&
    !input.replyId &&
    typed &&
    settings?.restartKeywords.some((word) => normalize(word) === typed)
  )
    return restart();

  // A card opened by its words ("Respuesta del usuario"), from anywhere.
  const opened = input.replyId ? null : entry(lastText);
  const open = (node: FlowNode) =>
    done(
      run(
        node.id,
        session ? { ...session.vars } : initialVars(context.variables),
      ),
    );

  if (!session) return opened ? open(opened) : restart();

  // After the end of the flow: the fallback text, as nothing is expected,
  // with a button to start again.
  if (opened && session.nodeId === null) return open(opened);
  if (session.nodeId === null) {
    const text = fill(settings?.fallbackText ?? '', session.vars).trim();
    if (text)
      say(
        fromStart.length > 0
          ? withButtons(text, fromStart)
          : { kind: 'text', text: cut(text, LIMITS.text) },
      );
    return done(session);
  }

  const waiting = byId.get(session.nodeId);
  if (!waiting || !waitsHere(waiting)) return restart();

  const vars = { ...session.vars };
  let handle: string | null = null;
  if (waiting.type === 'question') {
    if (save(waiting, vars, lastText)) handle = 'next';
  } else if (waiting.type === 'message' && hasOptions(waiting)) {
    const choices = waiting.data.options;
    const position = /^\d{1,2}$/.test(typed) ? Number(typed) - 1 : -1;
    const chosen =
      choices.find(
        (choice) => input.replyId === optionReplyId(waiting.id, choice.id),
      ) ??
      choices.find((choice) => normalize(choice.title) === typed) ??
      // "1", "2"… also choose, as customers often answer that way.
      choices[position];
    handle = chosen?.id ?? null;
  } else {
    // A menu written as text: the card whose words were written.
    const child = answered(waiting, lastText);
    if (child) return done(run(child.id, vars));
  }
  if (handle) return done(run(next(waiting, handle), vars));
  // Not an answer here, but the words of a card open from anywhere.
  if (opened) return open(opened);

  // An answer a question cannot take goes down its "respuesta no válida"
  // branch when it is connected.
  const invalid = waiting.type === 'question' ? next(waiting, 'other') : null;
  if (invalid) return done(run(invalid, vars));
  sorry(
    waiting,
    fill(
      waiting.type === 'question' || waiting.type === 'message'
        ? waiting.data.invalidText
        : '',
      vars,
    ).trim() ||
      fill(settings?.fallbackText ?? '', vars).trim() ||
      DEFAULT_INVALID_TEXT,
    vars,
  );
  return done({ nodeId: waiting.id, vars, attempts: session.attempts + 1 });
}

/**
 * Options of a «Respuesta» that WhatsApp can show as reply buttons: up to 3,
 * short titles and no descriptions. Otherwise they go as a list.
 */
export const sentAsButtons = (options: FlowReplyOption[]) =>
  options.length <= LIMITS.buttons &&
  options.every(
    (option) =>
      option.title.length <= LIMITS.buttonTitle && !option.description.trim(),
  );

/** A file of the chatbot as the header of an interactive message. */
function mediaHeader(
  media: BotMedia,
): NonNullable<InteractiveContent['headerMedia']> {
  return {
    type: media.type === 'audio' ? 'document' : media.type,
    fileId: media.fileId,
    mimeType: media.mimeType,
    filename: media.filename,
    size: media.size,
  };
}
