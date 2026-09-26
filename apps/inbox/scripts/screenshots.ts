import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { findRepoRoot } from "../lib/repoRoot";

/**
 * `pnpm --filter inbox screenshots` (issue #27): builds the app, boots
 * `next start` on a free port with an isolated audit dir and mock mode
 * forced, drives one headless Chromium page through it, and writes
 * docs/img/{list,detail-send,detail-update,approved}.png for the README.
 *
 * Memory-critical machine: one browser, one context, one page, navigated
 * sequentially rather than opened in parallel tabs.
 */

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = findRepoRoot(APP_DIR);
const IMG_DIR = path.join(REPO_ROOT, "docs", "img");
const MAX_BYTES = 400 * 1024;

const SEND_ACTION_ID = "001-gmail-send-email";
const UPDATE_ACTION_ID = "002-github-update-issue";

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: APP_DIR, env, stdio: "inherit", shell: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

/** Asks the OS for a free TCP port by binding to port 0. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("getFreePort: could not read the assigned port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function startServer(port: number, auditDir: string): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.INBOX_MODE; // force mock mode
  env.INBOX_AUDIT_DIR = auditDir;

  return spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
    cwd: APP_DIR,
    env,
    stdio: "inherit",
    shell: true,
    // POSIX: run in its own process group so we can kill the whole tree
    // (next start spawns a child worker process). Windows kills by PID
    // tree via taskkill instead, so detaching isn't needed there.
    detached: process.platform !== "win32",
  });
}

function killServer(server: ChildProcess): void {
  if (server.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"]);
  } else {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
}

function waitForServer(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2_000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else if (Date.now() > deadline) {
          reject(new Error(`server never returned 200 (last status ${res.statusCode})`));
        } else {
          setTimeout(attempt, 300);
        }
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`server on port ${port} never accepted connections`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    }
    attempt();
  });
}

function assertSmallEnough(filePath: string): void {
  const { size } = statSync(filePath);
  if (size > MAX_BYTES) {
    throw new Error(
      `${filePath} is ${size} bytes, over the ${MAX_BYTES} byte budget for README embeds`,
    );
  }
  console.log(`  ${path.relative(REPO_ROOT, filePath)}: ${size} bytes`);
}

async function main() {
  mkdirSync(IMG_DIR, { recursive: true });
  const auditDir = mkdtempSync(path.join(tmpdir(), "inbox-audit-"));

  console.log("Building inbox...");
  await run("pnpm", ["exec", "next", "build"], { ...process.env });

  const port = await getFreePort();
  console.log(`Starting inbox on port ${port} (INBOX_AUDIT_DIR=${auditDir})...`);
  const server = startServer(port, auditDir);

  try {
    await waitForServer(port);

    const browser = await chromium.launch({
      headless: true,
      args: ["--disable-gpu", "--disable-dev-shm-usage"],
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      try {
        const page = await context.newPage();
        const base = `http://127.0.0.1:${port}`;

        console.log("Capturing list.png...");
        await page.goto(base + "/", { waitUntil: "networkidle" });
        const listPath = path.join(IMG_DIR, "list.png");
        await page.screenshot({ path: listPath, type: "png", fullPage: false });
        assertSmallEnough(listPath);

        console.log("Capturing detail-send.png...");
        await page.goto(`${base}/actions/${SEND_ACTION_ID}`, { waitUntil: "networkidle" });
        const detailSendPath = path.join(IMG_DIR, "detail-send.png");
        await page.screenshot({ path: detailSendPath, type: "png", fullPage: false });
        assertSmallEnough(detailSendPath);

        console.log("Capturing approved.png...");
        await page.getByRole("button", { name: "Approve", exact: true }).click();
        await page.waitForSelector('[data-testid="decision-confirmation"]');
        const approvedPath = path.join(IMG_DIR, "approved.png");
        await page.screenshot({ path: approvedPath, type: "png", fullPage: false });
        assertSmallEnough(approvedPath);

        console.log("Capturing detail-update.png...");
        await page.goto(`${base}/actions/${UPDATE_ACTION_ID}`, { waitUntil: "networkidle" });
        const detailUpdatePath = path.join(IMG_DIR, "detail-update.png");
        await page.screenshot({ path: detailUpdatePath, type: "png", fullPage: false });
        assertSmallEnough(detailUpdatePath);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    console.log("Stopping inbox server...");
    killServer(server);
    try {
      rmSync(auditDir, { recursive: true, force: true });
    } catch {
      // best effort: a lingering handle on Windows must not fail the run
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
