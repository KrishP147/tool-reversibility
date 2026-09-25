/**
 * Regenerates the committed LLM test data from the trimmed catalog fixture:
 *
 *   fixtures/llm-recorded/trimmed.answers.json      synthetic per-slug answers
 *   fixtures/llm-recorded/batch-results.sample.jsonl result lines incl. refusal/errored/expired/canceled
 *   fixtures/llm-cache/<model>/*.json               cache replayed from the answers (provenance "recorded")
 *
 * The answers come from a slug-verb heuristic, NOT from a model: no API key
 * exists and implementers never call the paid API (D11). Every rationale says
 * so, and every cache entry is stamped `provenance: "recorded"`, which dry
 * runs and `--live` runs treat as a miss.
 *
 * Run: pnpm --filter audit fixture:llm
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ReversibilityClass } from "../classification.js";
import { loadSnapshotTools } from "../classifyCommand.js";
import {
  buildBatchRequest,
  DEFAULT_CLASSIFIER_MODEL,
  llmCacheRoot,
  loadPrompt,
  packRequests,
  PROMPT_VERSION,
  runLlmClassify,
  toPackItem,
  type BatchResultLine,
  type LlmToolOutput,
  type PackOptions,
} from "../llm.js";
import type { SnapshotTool } from "../normalize.js";
import { findRepoRoot } from "../paths.js";
import { writeJsonAtomic } from "../snapshot.js";
import { createFakeBatchClient, errored, recordedResponder, refused } from "./fakeAnthropic.js";

export const SYNTHETIC_NOTE =
  "Synthetic test data from a slug-verb heuristic, not model output. Regenerate with `pnpm --filter audit fixture:llm`.";
/** The sample JSONL covers the first SAMPLE_TOOLS non-deprecated trimmed tools, SAMPLE_PACK per request. */
export const SAMPLE_TOOLS = 25;
export const SAMPLE_PACK: Partial<PackOptions> = { maxToolsPerRequest: 5 };
/** Outcome per sample request, in custom_id order. */
export const SAMPLE_OUTCOMES = ["succeeded", "refusal", "errored", "expired", "canceled"] as const;

export function recordedDir(repoRoot: string): string {
  return path.join(repoRoot, "fixtures", "llm-recorded");
}

export function trimmedDir(repoRoot: string): string {
  return path.join(repoRoot, "fixtures", "catalog", "trimmed");
}

const VERBS: [ReversibilityClass, RegExp][] = [
  ["irreversible", /^(SEND|POST|REPLY|FORWARD|INVITE|MERGE|PUBLISH|RESET|REVOKE|CLEAR)$/],
  ["reversible", /^(GET|LIST|FETCH|SEARCH|FIND|READ|RETRIEVE|CHECK|DOWNLOAD|QUERY|FREE)$/],
  [
    "compensable",
    /^(CREATE|ADD|UPDATE|PATCH|MOVE|ARCHIVE|UNARCHIVE|MODIFY|SET|INSERT|APPEND|DUPLICATE|QUICK|ENCRYPT)$/,
  ],
];

/** Heuristic stand-in for a model answer. Deletes count as irreversible (no restore known). */
export function syntheticAnswer(tool: SnapshotTool): Omit<LlmToolOutput, "slug"> {
  const words = tool.slug.split("_").slice(1);
  let cls: ReversibilityClass = "unknown";
  let verb = "";
  for (const w of words) {
    if (w === "DELETE" || w === "REMOVE") {
      cls = "irreversible";
      verb = w;
      break;
    }
    const hit = VERBS.find(([, re]) => re.test(w));
    if (hit) {
      cls = hit[0];
      verb = w;
      break;
    }
  }
  const inverse =
    cls === "compensable" && verb === "CREATE" ? tool.slug.replace("_CREATE_", "_DELETE_") : null;
  return {
    class: cls,
    inverse_tool: inverse,
    rationale: `Synthetic fixture, not model output: verb ${verb || "none"} maps to ${cls}.`,
  };
}

export async function buildLlmFixture(repoRoot = findRepoRoot()): Promise<string[]> {
  const tools = loadSnapshotTools(trimmedDir(repoRoot), null);
  const system = loadPrompt(repoRoot);
  const model = DEFAULT_CLASSIFIER_MODEL;
  const dir = recordedDir(repoRoot);

  const answers: Record<string, Omit<LlmToolOutput, "slug">> = {};
  for (const t of tools) answers[t.slug] = syntheticAnswer(t);
  writeJsonAtomic(path.join(dir, "trimmed.answers.json"), {
    note: SYNTHETIC_NOTE,
    promptVersion: PROMPT_VERSION,
    model,
    answers,
  });

  // Sample result lines, one per outcome, in the real JSONL shape.
  const sampleTools = tools.filter((t) => !t.isDeprecated).slice(0, SAMPLE_TOOLS);
  const reqs = packRequests(
    sampleTools.map((t) => toPackItem(t)),
    SAMPLE_PACK,
  );
  const respond = recordedResponder(answers);
  const lines: BatchResultLine[] = reqs.map((r, i) => {
    const req = buildBatchRequest(model, system, r);
    const outcome = SAMPLE_OUTCOMES[i] ?? "succeeded";
    const result =
      outcome === "succeeded"
        ? respond(req)!
        : outcome === "refusal"
          ? refused()
          : outcome === "errored"
            ? errored()
            : { type: outcome };
    return { custom_id: r.customId, result };
  });
  writeFileSync(
    path.join(dir, "batch-results.sample.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    "utf8",
  );

  // Committed cache for the trimmed fixture, deprecated tools included.
  const res = await runLlmClassify({
    tools,
    model,
    cacheRoot: llmCacheRoot(repoRoot),
    systemPrompt: system,
    client: createFakeBatchClient({ respond }),
    acceptProvenance: ["live"], // rewrite recorded entries, never clobber real ones
    provenance: "recorded",
    sleep: async () => {},
  });
  return [
    `answers: ${Object.keys(answers).length}`,
    `sample lines: ${lines.length}`,
    `cache: ${res.written} written, ${res.hits} already present (${model})`,
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildLlmFixture().then(
    (out) => console.log(out.join("\n")),
    (err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
