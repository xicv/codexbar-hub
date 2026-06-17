import { spawn } from "node:child_process";
import { clearState, isPidAlive, nowSec, readState, writeState } from "./state.js";
import type { CaffeinateMode, CaffeinateState } from "./types.js";

export interface StartOptions {
  durationSeconds?: number;
  untilSessionEnd?: boolean;
  flags: string;
  claudePid?: number | null;
}

export interface StartResult {
  state: CaffeinateState;
  args: string[];
}

const CAFFEINATE_BIN = "/usr/bin/caffeinate";

export function startCaffeinate(opts: StartOptions): StartResult {
  stopCaffeinate();

  const args: string[] = [opts.flags];
  const startedAt = nowSec();
  const claudePid = opts.claudePid ?? null;
  let mode: CaffeinateMode = "infinite";
  let expiresAt: number | null = null;

  if (opts.untilSessionEnd && claudePid && isPidAlive(claudePid)) {
    args.push("-w", String(claudePid));
    mode = "session";
  } else if (opts.durationSeconds && opts.durationSeconds > 0) {
    args.push("-t", String(opts.durationSeconds));
    mode = "duration";
    expiresAt = startedAt + opts.durationSeconds;
  }

  const child = spawn(CAFFEINATE_BIN, args, { detached: true, stdio: "ignore" });
  child.unref();

  if (!child.pid) {
    throw new Error(`Failed to spawn ${CAFFEINATE_BIN} (no PID returned)`);
  }

  const state: CaffeinateState = {
    pid: child.pid,
    started_at: startedAt,
    expires_at: expiresAt,
    flags: opts.flags,
    mode,
    claude_pid: claudePid,
  };
  writeState(state);
  return { state, args };
}

export function stopCaffeinate(): { stopped: boolean; pid?: number } {
  const state = readState();
  if (!state) return { stopped: false };

  if (isPidAlive(state.pid)) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      /* may have exited between check and kill — race is safe */
    }
  }
  clearState();
  return { stopped: true, pid: state.pid };
}

export function getStatus(): CaffeinateState | null {
  const state = readState();
  if (!state) return null;

  if (!isPidAlive(state.pid)) {
    clearState();
    return null;
  }

  if (state.expires_at !== null && nowSec() > state.expires_at) {
    clearState();
    return null;
  }

  return state;
}
