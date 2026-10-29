import type { BotRequest, BotResponse } from '../domain/bot-request';
import type { Flow } from '../domain/flow';
import {
  advance,
  MAX_REQUESTS,
  type BotAction,
  type EngineContext,
  type EngineInput,
  type EngineSession,
} from '../domain/flow-engine';

export interface TurnResult {
  actions: BotAction[];
  session: EngineSession | null;
}

/**
 * One customer message through the flow, calling the «Consulta API» nodes
 * it reaches (at most MAX_REQUESTS; then the flow stops).
 */
export async function runTurn(
  flow: Flow,
  session: EngineSession | null,
  input: EngineInput,
  context: EngineContext,
  call: (request: BotRequest) => Promise<BotResponse>,
): Promise<TurnResult> {
  let result = advance(flow, session, input, context);
  const actions = [...result.actions];
  for (let calls = 0; result.request; calls++) {
    if (calls >= MAX_REQUESTS) return { actions, session: null };
    const response = await call(result.request);
    result = advance(
      flow,
      result.session,
      { text: input.text, replyId: null, response },
      context,
    );
    actions.push(...result.actions);
  }
  return { actions, session: result.session };
}
