import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CaffeinateState } from "./types.js";

const cacheRoot = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
export const STATE_DIR = join(cacheRoot, "caffeinate-mcp");
export const STATE_FILE = join(STATE_DIR, "state.json");

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function readState(): CaffeinateState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    return JSON.parse(raw) as CaffeinateState;
  } catch {
    return null;
  }
}

export function writeState(state: CaffeinateState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), "utf8");
  renameSync(tmp, STATE_FILE);
}

export function clearState(): void {
  if (!existsSync(STATE_FILE)) return;
  try {
    unlinkSync(STATE_FILE);
  } catch {
    /* ignore */
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
