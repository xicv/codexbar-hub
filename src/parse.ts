const ALLOWED_FLAGS = new Set(["d", "i", "m", "s", "u"]);

export function normalizeFlags(input: string | undefined, fallback = "-di"): string {
  if (!input) return fallback;
  const trimmed = input.trim();
  const body = trimmed.startsWith("-") ? trimmed.slice(1) : trimmed;
  const chars = Array.from(new Set(body.split("")));
  const filtered = chars.filter((c) => ALLOWED_FLAGS.has(c));
  if (filtered.length === 0) return fallback;
  return `-${filtered.join("")}`;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (h === 0 && m < 5 && s > 0) parts.push(`${s}s`);
  return parts.length > 0 ? parts.join(" ") : "0s";
}

export function renderBar(percent: number, width = 10): string {
  const clamped = Math.max(0, Math.min(1, percent));
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
