/**
 * Fake Message Batches client for tests and for replaying recorded
 * responses. Never touches the network. (fakeClient.ts is the Composio fake.)
 */
import type Anthropic from "@anthropic-ai/sdk";
import type {
  BatchClient,
  BatchRequest,
  BatchResultLine,
  LlmToolOutput,
  PromptTool,
} from "../llm.js";

export type BatchResult = BatchResultLine["result"];

/** A succeeded result carrying `text` as the only content block. */
export function succeeded(
  text: string,
  stopReason: Anthropic.Messages.StopReason = "end_turn",
  model = "claude-sonnet-5",
): BatchResult {
  const message = {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  return { type: "succeeded", message: message as unknown as Anthropic.Messages.Message };
}

export function refused(): BatchResult {
  const r = succeeded("", "refusal");
  if (r.type === "succeeded") {
    (r.message as unknown as Record<string, unknown>).stop_details = {
      type: "refusal",
      category: null,
      explanation: "recorded refusal (synthetic)",
    };
  }
  return r;
}

export function errored(): BatchResult {
  return {
    type: "errored",
    error: {
      type: "error",
      error: { type: "api_error", message: "recorded server error (synthetic)" },
    },
  } as unknown as BatchResult;
}

/** Tools the request asks about, parsed back out of the user message. */
export function promptToolsOf(req: BatchRequest): PromptTool[] {
  const msg = req.params.messages[0];
  const content = typeof msg?.content === "string" ? msg.content : "";
  const json = content.slice(content.indexOf("\n\n") + 2);
  return JSON.parse(json) as PromptTool[];
}

/** Answers every tool it has a recorded output for, by slug. */
export function recordedResponder(
  answers: Record<string, Omit<LlmToolOutput, "slug">>,
): (req: BatchRequest) => BatchResult | null {
  return (req) => {
    const results = promptToolsOf(req)
      .filter((t) => answers[t.slug])
      .map((t) => ({ slug: t.slug, ...answers[t.slug] }));
    return succeeded(JSON.stringify({ results }), "end_turn", req.params.model);
  };
}

export interface FakeBatchOptions {
  /** Result per request; null omits the line. */
  respond: (req: BatchRequest) => BatchResult | null;
  /** Emit results in reverse order (results arrive in any order). */
  shuffle?: boolean;
  /** `retrieve` calls reporting in_progress before `ended`. */
  pollsBeforeEnd?: number;
}

export interface FakeBatchClient extends BatchClient {
  created: BatchRequest[][];
  retrieveCalls: number;
}

export function createFakeBatchClient(opts: FakeBatchOptions): FakeBatchClient {
  const batches = new Map<string, BatchRequest[]>();
  const polls = new Map<string, number>();
  const fake: FakeBatchClient = {
    created: [],
    retrieveCalls: 0,
    async create(requests) {
      const id = `msgbatch_fake_${batches.size}`;
      batches.set(id, requests);
      polls.set(id, 0);
      fake.created.push(requests);
      return { id };
    },
    async retrieve(id) {
      fake.retrieveCalls += 1;
      const n = polls.get(id) ?? 0;
      polls.set(id, n + 1);
      const ended = n >= (opts.pollsBeforeEnd ?? 0);
      return { id, processing_status: ended ? "ended" : "in_progress" };
    },
    async results(id) {
      const reqs = batches.get(id) ?? [];
      const lines: BatchResultLine[] = [];
      for (const req of reqs) {
        const result = opts.respond(req);
        if (result) lines.push({ custom_id: req.custom_id, result });
      }
      if (opts.shuffle) lines.reverse();
      return (async function* () {
        yield* lines;
      })();
    },
  };
  return fake;
}

/** Replays recorded JSONL result lines by custom_id. */
export function replayLines(lines: BatchResultLine[]): (req: BatchRequest) => BatchResult | null {
  const byId = new Map(lines.map((l) => [l.custom_id, l.result]));
  return (req) => byId.get(req.custom_id) ?? null;
}
