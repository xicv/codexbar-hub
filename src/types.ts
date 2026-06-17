export type CaffeinateMode = "duration" | "session" | "infinite";

export interface CaffeinateState {
  pid: number;
  started_at: number;
  expires_at: number | null;
  flags: string;
  mode: CaffeinateMode;
  claude_pid: number | null;
}

export interface CaffeinateStatus {
  active: boolean;
  mode?: CaffeinateMode;
  flags?: string;
  started_at?: number;
  expires_at?: number | null;
  remaining_seconds?: number | null;
  elapsed_seconds?: number;
  pid?: number;
}
