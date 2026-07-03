import { test } from "node:test";
import assert from "node:assert/strict";

const { parseNumstat, parseAheadBehind, formatGitSegment } = await import("../dist/git.js");

test("parseNumstat sums added/deleted across files", () => {
  const out = "3\t1\tsrc/a.ts\n40\t0\tsrc/b.ts\n";
  assert.deepEqual(parseNumstat(out), { added: 43, deleted: 1 });
});

test("parseNumstat ignores binary files ('-' columns)", () => {
  const out = "-\t-\tassets/logo.png\n5\t2\tsrc/a.ts\n";
  assert.deepEqual(parseNumstat(out), { added: 5, deleted: 2 });
});

test("parseNumstat returns null when there is no net change", () => {
  assert.equal(parseNumstat(""), null);
  assert.equal(parseNumstat("0\t0\tsrc/a.ts\n"), null);
});

test("parseAheadBehind parses 'behind<TAB>ahead'", () => {
  assert.deepEqual(parseAheadBehind("1\t2"), { behind: 1, ahead: 2 });
});

test("parseAheadBehind handles null/malformed input", () => {
  assert.deepEqual(parseAheadBehind(null), { ahead: 0, behind: 0 });
  assert.deepEqual(parseAheadBehind("garbage"), { ahead: 0, behind: 0 });
});

test("formatGitSegment: clean branch (no color)", () => {
  const seg = formatGitSegment({ branch: "main", dirty: false, ahead: 0, behind: 0, diff: null }, { color: false });
  assert.equal(seg, "git:(main)");
});

test("formatGitSegment: dirty + ahead + diffstat (no color)", () => {
  const seg = formatGitSegment(
    { branch: "main", dirty: true, ahead: 2, behind: 0, diff: { added: 45, deleted: 12 } },
    { color: false },
  );
  assert.equal(seg, "git:(main* ↑2 [+45 -12])");
});

test("formatGitSegment: behind + additions only (no color)", () => {
  const seg = formatGitSegment(
    { branch: "dev", dirty: true, ahead: 0, behind: 3, diff: { added: 7, deleted: 0 } },
    { color: false },
  );
  assert.equal(seg, "git:(dev* ↓3 [+7])");
});

test("formatGitSegment: emits ANSI colors by default", () => {
  const seg = formatGitSegment({ branch: "main", dirty: false, ahead: 0, behind: 0, diff: null });
  assert.match(seg, /\x1b\[/);
  assert.match(seg, /main/);
});
