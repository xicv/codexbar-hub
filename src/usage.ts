import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Reads usage snapshots that CodexBar.app keeps fresh in the background and
// renders pace-marker bars (filled = used%, ┃ = where elapsed time says you
// "should" be). Pure file reads — no network, no subprocess — so it is safe to
// call on every statusline render. Any missing/!malformed file yields "" and
// the statusline simply omits the usage lines.

const CODEXBAR_DIR = join(homedir(), "Library", "Application Support", "com.steipete.codexbar");
const OPENAI_FILE = join(CODEXBAR_DIR, "openai-dashboard.json");
const CLAUDE_FILE = join(CODEXBAR_DIR, "history", "claude.json");

const BAR_WIDTH = 10;
const FILLED = "█";
const EMPTY = "░";
const MARKER = "┃";

const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

interface Limit {
  usedPercent: number;
  windowMinutes: number;
  resetsAt?: string;
  resetDescription?: string;
}

interface ProviderUsage {
  session?: Limit;
  weekly?: Limit;
}

// CodexBar.app keeps the cache files fresh; if it isn't running the data is
// stale, so hide the bars entirely rather than show last-known numbers.
function isCodexBarRunning(): boolean {
  try {
    const res = spawnSync("pgrep", ["-x", "CodexBar"], { encoding: "utf8", timeout: 1000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function toLimit(raw: unknown): Limit | undefined {
  const o = obj(raw);
  if (!o) return undefined;
  const usedPercent = typeof o.usedPercent === "number" ? o.usedPercent : undefined;
  const windowMinutes = typeof o.windowMinutes === "number" ? o.windowMinutes : undefined;
  if (usedPercent === undefined || windowMinutes === undefined) return undefined;
  return {
    usedPercent,
    windowMinutes,
    resetsAt: typeof o.resetsAt === "string" ? o.resetsAt : undefined,
    resetDescription: typeof o.resetDescription === "string" ? o.resetDescription : undefined,
  };
}

function readCodex(): ProviderUsage | null {
  const snapshot = obj(pick(readJson(OPENAI_FILE), ["snapshot"]));
  if (!snapshot) return null;
  const session = toLimit(snapshot.primaryLimit);
  const weekly = toLimit(snapshot.secondaryLimit);
  return session || weekly ? { session, weekly } : null;
}

function readClaude(): ProviderUsage | null {
  const root = obj(readJson(CLAUDE_FILE));
  const accounts = obj(root?.accounts);
  if (!root || !accounts) return null;
  const key = typeof root.preferredAccountKey === "string" ? root.preferredAccountKey : Object.keys(accounts)[0];
  const windows = key ? accounts[key] : undefined;
  if (!Array.isArray(windows)) return null;

  const latest = (w: Record<string, unknown>): Limit | undefined => {
    const entries = w.entries;
    if (!Array.isArray(entries) || entries.length === 0) return undefined;
    const last = obj(entries[entries.length - 1]);
    const windowMinutes = typeof w.windowMinutes === "number" ? w.windowMinutes : undefined;
    const usedPercent = last && typeof last.usedPercent === "number" ? last.usedPercent : undefined;
    if (windowMinutes === undefined || usedPercent === undefined) return undefined;
    return {
      usedPercent,
      windowMinutes,
      resetsAt: last && typeof last.resetsAt === "string" ? last.resetsAt : undefined,
    };
  };

  let session: Limit | undefined;
  let weekly: Limit | undefined;
  for (const raw of windows) {
    const w = obj(raw);
    if (!w) continue;
    if (w.name === "session" || w.windowMinutes === 300) session = latest(w);
    else if (w.name === "weekly") weekly = latest(w);
  }
  return session || weekly ? { session, weekly } : null;
}

function pick(o: unknown, path: string[]): unknown {
  let cur: unknown = o;
  for (const key of path) {
    const next = obj(cur);
    if (!next) return undefined;
    cur = next[key];
  }
  return cur;
}

// Milliseconds until the window resets, or null when it cannot be determined.
// CodexBar's Codex 5h window has no resetsAt, only a "Resets 2:30 PM" / "Resets
// Jun 18, 2026 10:10 AM" description, so fall back to parsing that.
function resetMs(limit: Limit, now: number): number | null {
  if (limit.resetsAt) {
    const t = Date.parse(limit.resetsAt);
    if (!Number.isNaN(t)) return t;
  }
  const desc = limit.resetDescription;
  if (!desc) return null;
  const body = desc.replace(/^Resets\s+/i, "").trim();

  const full = Date.parse(body);
  if (!Number.isNaN(full)) return full;

  const clock = body.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (clock?.[1] && clock[2]) {
    const meridiem = clock[3]?.toUpperCase();
    let hour = Number.parseInt(clock[1], 10);
    const minute = Number.parseInt(clock[2], 10);
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    const d = new Date(now);
    d.setHours(hour, minute, 0, 0);
    let t = d.getTime();
    if (t <= now) t += 24 * 60 * 60 * 1000; // reset already passed today → tomorrow
    return t;
  }
  return null;
}

// Fraction of the window elapsed (0..1), i.e. where the pace marker sits.
function paceFraction(limit: Limit, now: number): number | null {
  const reset = resetMs(limit, now);
  if (reset === null) return null;
  const windowMs = limit.windowMinutes * 60_000;
  const start = reset - windowMs;
  const frac = (now - start) / windowMs;
  return Math.max(0, Math.min(1, frac));
}

function clampIdx(i: number): number {
  return Math.max(0, Math.min(BAR_WIDTH, i));
}

function renderBar(limit: Limit, now: number, color: boolean): string {
  const used = Math.max(0, Math.min(100, limit.usedPercent)) / 100;
  const filled = Math.round(used * BAR_WIDTH);
  const pace = paceFraction(limit, now);

  const cells: string[] = [];
  for (let i = 0; i < BAR_WIDTH; i++) cells.push(i < filled ? FILLED : EMPTY);

  const overused = pace !== null && used > pace;
  const fillColor = overused ? ANSI.red : ANSI.green;
  const paint = (c: string, i: number): string => {
    if (!color) return c;
    return i < filled ? `${fillColor}${c}${ANSI.reset}` : `${ANSI.dim}${c}${ANSI.reset}`;
  };
  const cellStrs = cells.map(paint);

  if (pace !== null) {
    const markerIdx = clampIdx(Math.round(pace * BAR_WIDTH));
    const marker = color ? `${ANSI.bold}${ANSI.yellow}${MARKER}${ANSI.reset}` : MARKER;
    const withMarker = [...cellStrs.slice(0, markerIdx), marker, ...cellStrs.slice(markerIdx)].join("");
    return `▕${withMarker}▏`;
  }
  return `▕${cellStrs.join("")}▏`;
}

function pct(limit: Limit): string {
  return `${String(Math.round(limit.usedPercent)).padStart(2, " ")}%`;
}

function renderProvider(label: string, usage: ProviderUsage, now: number, color: boolean): string | null {
  const segs: string[] = [];
  if (usage.session) segs.push(`5h ${renderBar(usage.session, now, color)} ${pct(usage.session)}`);
  if (usage.weekly) segs.push(`7d ${renderBar(usage.weekly, now, color)} ${pct(usage.weekly)}`);
  if (segs.length === 0) return null;
  const name = color ? `${ANSI.bold}${label}${ANSI.reset}` : label;
  return `${name}  ${segs.join("  ")}`;
}

export function renderUsageLines(now: number = Date.now()): string {
  if (process.env.CAFFEINATE_USAGE_DISABLE === "1") return "";
  if (!isCodexBarRunning()) return "";
  const color = !process.env.NO_COLOR;
  const lines: string[] = [];

  const codex = readCodex();
  if (codex) {
    const line = renderProvider("Codex ", codex, now, color);
    if (line) lines.push(line);
  }
  const claude = readClaude();
  if (claude) {
    const line = renderProvider("Claude", claude, now, color);
    if (line) lines.push(line);
  }
  return lines.join("\n");
}
