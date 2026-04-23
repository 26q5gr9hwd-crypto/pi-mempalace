/**
 * pi-mempalace — auto-capture heuristics (MONDAY-L2-15)
 *
 * Used by the `turn_end` hook in index.ts to replace hard-coded defaults
 * (`topic="general"`, `importance=0.5`) with cheap local heuristics and to
 * suppress near-duplicate captures within a short window per session.
 *
 * Motivation: MONDAY-L2-14 audit found 91.6% of Monday's memories were
 * undifferentiated auto-capture noise all stamped with those defaults, with
 * near-duplicates repeating 4-13x from the same session.
 */

// -------- Adaptive importance (Option B from MONDAY-L2-7) --------
export function scoreAutoCapture(content: string): number {
  const trimmed = content.trim();
  const lc = content.toLowerCase();

  // Trivial filler -> demote to 0.3
  if (content.length < 150) return 0.3;
  if (/^(ok|thanks|got it|cool|nice|yep|yeah|sure)\b/i.test(trimmed)) return 0.3;

  // High-signal keywords -> promote to 0.7
  const signals = [
    "remember", "decided", "decision", "key insight", "important",
    "fixed", "root cause", "error:", "exception", "stack trace",
    "\u0060\u0060\u0060", // code fences
    "config", "configuration", "patch", "deploy",
  ];
  if (signals.some((k) => lc.includes(k))) return 0.7;

  // Baseline
  return 0.5;
}

// -------- Heuristic topic (Option A from MONDAY-L2-7) --------
export function pickTopic(content: string): string {
  const lc = content.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/\b(subagent|web-researcher|file-worker)\b/, "subagents"],
    [/\b(config|settings|model|provider|openrouter)\b/, "configuration"],
    [/\b(deploy|docker|compose|container|vps)\b/, "deployment"],
    [/\b(pi-vcc|compaction|compact|summary)\b/, "pi-vcc"],
    [/\b(memory|mempalace|wake-?up|diary)\b/, "memory"],
    [/\b(architecture|design|plan)\b/, "architecture"],
    [/\b(error|exception|stack trace|bug|fix)\b/, "debugging"],
    [/\u0060\u0060\u0060/, "code"],
  ];
  for (const [re, t] of rules) if (re.test(lc)) return t;
  return "general";
}

// -------- Near-duplicate suppression (in-memory, 60s per session) --------
// Auto-capture duplicates overwhelmingly come from the same pi process
// re-storing similar exchanges as a session iterates. An in-memory set keyed
// by session_id with a 60s TTL is sufficient for the stated test case
// ("same message 3x in 60s produces 1 row, not 3") and avoids a DB round trip.
type DedupeEntry = { prefix: string; ts: number };
const RECENT_CAPTURES: Map<string, DedupeEntry[]> = new Map();
const DEDUPE_WINDOW_MS = 60_000;
const DEDUPE_PREFIX_LEN = 100;
const DEDUPE_MAX_PER_SESSION = 64;

export function isRecentDuplicate(sessionId: string, content: string): boolean {
  const now = Date.now();
  const prefix = content.slice(0, DEDUPE_PREFIX_LEN);
  const list = RECENT_CAPTURES.get(sessionId) || [];
  const fresh = list.filter((e) => now - e.ts < DEDUPE_WINDOW_MS);
  const dup = fresh.some((e) => e.prefix === prefix);
  if (!dup) {
    fresh.push({ prefix, ts: now });
    while (fresh.length > DEDUPE_MAX_PER_SESSION) fresh.shift();
  }
  RECENT_CAPTURES.set(sessionId, fresh);
  return dup;
}

// Diagnostic accessor.
export function _dedupeStateSize(): number {
  let total = 0;
  for (const v of RECENT_CAPTURES.values()) total += v.length;
  return total;
}
