/**
 * Throwaway repro for issue #12: reproduce the @composio/core 0.21.0 zod
 * rejection offline, against the committed catalog snapshot, without any
 * live API calls.
 *
 * `getRawComposioTools` parses each REST tool through `ToolSchema.parse`
 * (Tools.ts `transformToolCases`, not `safeParse`), so the first tool whose
 * `inputParameters` the schema rejects throws a ZodError with no HTTP
 * status; `fetch.ts` treats that as `fallbackReason: "sdk-error"` and falls
 * back to the raw REST list (D21, skilleddocs/plan.md).
 *
 * This script re-parses the REST-shaped tools already on disk (the fallback
 * path fetched them without the SDK's zod check) through the SDK's own
 * `ToolSchema`, and reports which tools fail and why.
 *
 * Usage: tsx packages/audit/scripts/sdk-schema-repro.ts --dir <snapshot-dir>
 * (a `fixtures/catalog/<date>` directory containing `manifest.json` plus
 * one `<slug>.json` per toolkit).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ToolSchema } from "@composio/core";

interface ManifestToolkit {
  fallbackReason?: string;
}

interface Manifest {
  toolkits: Record<string, ManifestToolkit>;
}

interface SnapshotTool {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  inputParameters: unknown;
  toolkit: { slug: string; name: string };
  version: string | null;
  isDeprecated: boolean;
  scopes: string[];
}

interface SnapshotFile {
  tools: SnapshotTool[];
}

function parseArgs(argv: string[]): { dir: string } {
  const idx = argv.indexOf("--dir");
  const dir = idx !== -1 ? argv[idx + 1] : undefined;
  if (!dir) {
    throw new Error("usage: sdk-schema-repro.ts --dir <fixtures/catalog/DATE>");
  }
  return { dir };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function main(): Promise<void> {
  const { dir } = parseArgs(process.argv.slice(2));
  const manifest = await readJson<Manifest>(join(dir, "manifest.json"));
  const sdkErrorSlugs = Object.entries(manifest.toolkits)
    .filter(([, tk]) => tk.fallbackReason === "sdk-error")
    .map(([slug]) => slug)
    .sort();

  if (sdkErrorSlugs.length === 0) {
    console.log("No toolkits with fallbackReason=sdk-error in this manifest.");
    return;
  }

  console.log(`${sdkErrorSlugs.length} toolkit(s) with fallbackReason=sdk-error:\n`);

  for (const slug of sdkErrorSlugs) {
    const snapshot = await readJson<SnapshotFile>(join(dir, `${slug}.json`));
    let failing = 0;
    let sample: { tool: string; path: string; message: string } | undefined;

    for (const tool of snapshot.tools) {
      // Rebuild the shape `transformToolCases` hands to `ToolSchema.parse`
      // (camelCase; the snapshot already stores it this way, D19/normalize.ts).
      const candidate = {
        slug: tool.slug,
        name: tool.name,
        description: tool.description,
        inputParameters: tool.inputParameters,
        tags: tool.tags,
        toolkit: tool.toolkit,
        version: tool.version ?? undefined,
        isDeprecated: tool.isDeprecated,
        scopes: tool.scopes,
      };
      const result = ToolSchema.safeParse(candidate);
      if (!result.success) {
        failing += 1;
        if (!sample) {
          const issue = result.error.issues[0];
          sample = {
            tool: tool.slug,
            path: issue ? issue.path.join(".") : "(no issues?)",
            message: issue ? issue.message : "(no issues?)",
          };
        }
      }
    }

    console.log(`${slug}: ${failing}/${snapshot.tools.length} tools fail ToolSchema.safeParse`);
    if (sample) {
      console.log(`  e.g. ${sample.tool} at ${sample.path}: ${sample.message}`);
    } else if (failing === 0) {
      console.log(
        "  (no inputParameters failure found; the rejection likely came from a field this snapshot doesn't capture, e.g. output_parameters)",
      );
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
