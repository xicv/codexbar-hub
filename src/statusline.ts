#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStatus } from "./caffeinate.js";
import { formatDuration, renderBar } from "./parse.js";
import { STATE_DIR } from "./state.js";
import { renderUsageLines } from "./usage.js";

interface HudInvocation {
  cmd: string;
  args: string[];
}

const HUD_CACHE_FILE = join(STATE_DIR, "hud-cache.json");
const HUD_TIMEOUT_MS = 5000;
const BAR_WIDTH = 10;

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseEnvCommand(envCmd: string | undefined): HudInvocation | null {
  if (!envCmd) return null;
  const parts = envCmd.split(/\s+/).filter(Boolean);
  const [head, ...rest] = parts;
  return head ? { cmd: head, args: rest } : null;
}

function readHudCache(): HudInvocation | null {
  if (!existsSync(HUD_CACHE_FILE)) return null;
  try {
    const raw = readFileSync(HUD_CACHE_FILE, "utf8");
    const cached = JSON.parse(raw) as HudInvocation;
    if (!existsSync(cached.cmd)) return null;
    const lastArg = cached.args[cached.args.length - 1];
    if (lastArg && lastArg.startsWith("/") && !existsSync(lastArg)) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeHudCache(inv: HudInvocation): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${HUD_CACHE_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(inv), "utf8");
    renameSync(tmp, HUD_CACHE_FILE);
  } catch {
    /* cache write failures are non-fatal */
  }
}

function resolveBun(): string | null {
  const candidates = [
    process.env.BUN_PATH,
    process.env.HOME ? `${process.env.HOME}/.bun/bin/bun` : undefined,
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function findClaudeHudDir(): string | null {
  const configDir = process.env.CLAUDE_CONFIG_DIR || (process.env.HOME ? `${process.env.HOME}/.claude` : null);
  if (!configDir) return null;
  const cacheRoot = join(configDir, "plugins", "cache", "claude-hud", "claude-hud");
  if (!existsSync(cacheRoot)) return null;

  try {
    const versions = readdirSync(cacheRoot)
      .filter((v) => /^\d+\.\d+\.\d+/.test(v))
      .sort(compareSemver)
      .reverse();
    const latest = versions[0];
    return latest ? join(cacheRoot, latest) : null;
  } catch {
    return null;
  }
}

function resolveClaudeHudFresh(): HudInvocation | null {
  const pluginDir = findClaudeHudDir();
  if (!pluginDir) return null;

  const entryTs = join(pluginDir, "src", "index.ts");
  const entryJs = join(pluginDir, "dist", "index.js");

  if (existsSync(entryTs)) {
    const bun = resolveBun();
    if (bun) return { cmd: bun, args: ["--env-file", "/dev/null", entryTs] };
  }
  if (existsSync(entryJs)) {
    return { cmd: "node", args: [entryJs] };
  }
  return null;
}

function resolveClaudeHud(): HudInvocation | null {
  const fromEnv = parseEnvCommand(process.env.CAFFEINATE_HUD_CMD);
  if (fromEnv) return fromEnv;

  const cached = readHudCache();
  if (cached) return cached;

  const fresh = resolveClaudeHudFresh();
  if (fresh) writeHudCache(fresh);
  return fresh;
}

function runHud(stdin: string): string {
  if (process.env.CAFFEINATE_HUD_DISABLE === "1") return "";
  const inv = resolveClaudeHud();
  if (!inv) return "";
  const res = spawnSync(inv.cmd, inv.args, {
    input: stdin,
    encoding: "utf8",
    timeout: HUD_TIMEOUT_MS,
  });
  return res.status === 0 && res.stdout ? res.stdout.trimEnd() : "";
}

function renderFallback(stdin: string): string {
  if (!stdin) return "";
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(stdin) as Record<string, unknown>;
  } catch {
    return "";
  }
  const model = pickString(data, ["model", "display_name"]) ?? pickString(data, ["model", "id"]) ?? "Claude";
  const dir = pickString(data, ["workspace", "current_dir"]) ?? pickString(data, ["cwd"]);
  const ctx = pickNumber(data, ["context_window", "used_percentage"]);

  const parts: string[] = [`[${model}]`];
  if (dir) parts.push(shortPath(dir));
  if (typeof ctx === "number") parts.push(`ctx ${Math.round(ctx)}%`);
  return parts.join(" ");
}

function pick(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function pickString(obj: unknown, path: string[]): string | undefined {
  const v = pick(obj, path);
  return typeof v === "string" ? v : undefined;
}

function pickNumber(obj: unknown, path: string[]): number | undefined {
  const v = pick(obj, path);
  return typeof v === "number" ? v : undefined;
}

function shortPath(p: string): string {
  const home = process.env.HOME;
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function renderCaffeineSegment(): string {
  const state = getStatus();
  if (!state) return "";

  if (state.mode === "session") return "☕ until session end";

  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.max(0, now - state.started_at);

  if (state.mode === "duration" && state.expires_at !== null) {
    const total = state.expires_at - state.started_at;
    const remaining = Math.max(0, state.expires_at - now);
    const percent = total > 0 ? elapsed / total : 0;
    return `☕ ${formatDuration(remaining)} ${renderBar(percent, BAR_WIDTH)} ${Math.round(percent * 100)}%`;
  }

  return `☕ ${formatDuration(elapsed)} (∞)`;
}

function main(): void {
  const stdin = readStdin();
  const hudOut = runHud(stdin) || renderFallback(stdin);
  const segment = renderCaffeineSegment();
  const sep = process.env.CAFFEINATE_HUD_SEP || " │ ";

  const lines: string[] = [];
  if (hudOut && segment) lines.push(`${hudOut}${sep}${segment}`);
  else if (hudOut) lines.push(hudOut);
  else if (segment) lines.push(segment);

  const usage = renderUsageLines();
  if (usage) lines.push(usage);

  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

main();
