/**
 * Local, offline cost estimate for an LLM classify pass (D11). No
 * `count_tokens` call: tokens are estimated at CHARS_PER_TOKEN, which is the
 * point — a dry run must not touch the network or need a key.
 */

/** Rough chars-per-token for English + JSON on current Claude tokenizers. */
export const CHARS_PER_TOKEN = 3.5;
/** Expected structured-output tokens per classified tool (slug, class, inverse, ≤200-char rationale). */
export const OUTPUT_TOKENS_PER_TOOL = 80;
/** JSON envelope + per-request framing, output side. */
export const OUTPUT_TOKENS_PER_REQUEST = 20;

export const SONNET_MODEL = "claude-sonnet-5";
export const OPUS_MODEL = "claude-opus-5";

/**
 * Message Batches API prices, USD per million tokens (50% of standard).
 * Standard (claude-api skill, cached 2026-06-24): sonnet-5 $2/$10, opus-5 $5/$25.
 */
export const BATCH_PRICES: Record<string, { input: number; output: number }> = {
  [SONNET_MODEL]: { input: 1, output: 5 },
  [OPUS_MODEL]: { input: 2.5, output: 12.5 },
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface TokenEstimate {
  requests: number;
  tools: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CostEstimate extends TokenEstimate {
  model: string;
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
}

/** Returns null for a model with no known batch price. */
export function priceEstimate(model: string, t: TokenEstimate): CostEstimate | null {
  const p = BATCH_PRICES[model];
  if (!p) return null;
  const inputUsd = (t.inputTokens / 1e6) * p.input;
  const outputUsd = (t.outputTokens / 1e6) * p.output;
  return { model, ...t, inputUsd, outputUsd, totalUsd: inputUsd + outputUsd };
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}
