import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmpRoot = mkdtempSync(join(tmpdir(), "caffeinate-statusline-test-"));
process.env.XDG_CACHE_HOME = tmpRoot;

const { startCaffeinate, stopCaffeinate } = await import("../dist/caffeinate.js");
const { test, after } = await import("node:test");
const { default: assert } = await import("node:assert/strict");

const SCRIPT = new URL("../dist/statusline.js", import.meta.url).pathname;

after(() => {
  stopCaffeinate();
  rmSync(tmpRoot, { recursive: true, force: true });
});

function runStatusline(stdin, extraEnv = {}) {
  const env = {
    ...process.env,
    XDG_CACHE_HOME: tmpRoot,
    CAFFEINATE_HUD_DISABLE: "1",
    CAFFEINATE_USAGE_DISABLE: "1",
    ...extraEnv,
  };
  const res = spawnSync("node", [SCRIPT], { input: stdin, encoding: "utf8", env, timeout: 5000 });
  return { status: res.status, stdout: res.stdout.trimEnd(), stderr: res.stderr };
}

test("fallback: renders [model] dir ctx% from stdin JSON", () => {
  const stdin = JSON.stringify({
    model: { display_name: "Opus 4.7" },
    workspace: { current_dir: process.env.HOME + "/some/path" },
    context_window: { used_percentage: 33 },
  });
  const { stdout } = runStatusline(stdin);
  assert.match(stdout, /\[Opus 4\.7\]/);
  assert.match(stdout, /~\/some\/path/);
  assert.match(stdout, /ctx 33%/);
});

test("fallback: uses model.id when display_name missing", () => {
  const stdin = JSON.stringify({ model: { id: "claude-opus-4-7" } });
  const { stdout } = runStatusline(stdin);
  assert.match(stdout, /\[claude-opus-4-7\]/);
});

test("fallback: empty stdin produces no output", () => {
  const { stdout } = runStatusline("");
  assert.equal(stdout, "");
});

test("fallback: malformed JSON produces no output", () => {
  const { stdout } = runStatusline("not json {{");
  assert.equal(stdout, "");
});

test("caffeinate active appends ☕ segment with bar", () => {
  startCaffeinate({ durationSeconds: 60, flags: "-di", claudePid: null });
  try {
    const stdin = JSON.stringify({ model: { display_name: "Opus" } });
    const { stdout } = runStatusline(stdin);
    assert.match(stdout, /☕/);
    assert.match(stdout, /\d+s|\d+m/);
    assert.match(stdout, /[█░]/);
  } finally {
    stopCaffeinate();
  }
});

test("session mode shows 'until session end' (no bar)", () => {
  startCaffeinate({ untilSessionEnd: true, flags: "-di", claudePid: process.pid });
  try {
    const { stdout } = runStatusline(JSON.stringify({ model: { display_name: "X" } }));
    assert.match(stdout, /☕ until session end/);
    assert.doesNotMatch(stdout, /[█░]/);
  } finally {
    stopCaffeinate();
  }
});

test("CAFFEINATE_HUD_SEP overrides separator", () => {
  startCaffeinate({ durationSeconds: 60, flags: "-di", claudePid: null });
  try {
    const { stdout } = runStatusline(JSON.stringify({ model: { display_name: "X" } }), {
      CAFFEINATE_HUD_SEP: " ▸ ",
    });
    assert.match(stdout, / ▸ ☕/);
  } finally {
    stopCaffeinate();
  }
});

test("no caffeinate + no HUD = only fallback", () => {
  const stdin = JSON.stringify({ model: { display_name: "X" } });
  const { stdout } = runStatusline(stdin);
  assert.match(stdout, /^\[X\]/);
  assert.doesNotMatch(stdout, /☕/);
});
