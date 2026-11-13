/**
 * Paint order in a shared diagram: each node has a sort key (a string), and the order is the
 * nodes sorted by key (ties by id). Moving one node to the front or back changes just its key,
 * so two people reordering different nodes at once don't undo each other's changes, as they
 * would rewriting one shared list.
 *
 * Keys are digit strings compared as text, in base 36 ("0"-"9", "a"-"z": ASCII order). A key
 * can always be made between two others; none ends in "0", so there's always room after one.
 */
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const digit = (s: string, i: number) => DIGITS.indexOf(s[i]);

/** A key after `a` and before `b` (null: no bound that way). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);
  const lo = a ?? "";
  let hi = b;
  let out = "";
  for (let i = 0; ; i++) {
    const da = i < lo.length ? digit(lo, i) : 0;
    const db = hi !== null && i < hi.length ? digit(hi, i) : BASE;
    if (da === db) {
      out += DIGITS[da];
      continue;
    }
    const mid = Math.floor((da + db) / 2);
    if (mid > da) return out + DIGITS[mid];
    // Adjacent digits: keep a's, and anything after it is below b.
    out += DIGITS[da];
    hi = null;
  }
}

/**
 * New keys for the nodes in `order` (back to front) given their current `keys`: the nodes that
 * are already in order (the longest run of them, by key) keep theirs; the rest get keys between
 * their neighbors. Returns only the keys that change.
 */
export function rekey(order: string[], keys: Map<string, string>): Map<string, string> {
  // The longest increasing subsequence of current keys, in `order` (patience sorting).
  const idx = order.map((_, i) => i).filter((i) => keys.has(order[i]));
  const tails: number[] = [];
  const prev = new Map<number, number>();
  for (const i of idx) {
    const k = keys.get(order[i])!;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cmp(keys.get(order[tails[m]])!, order[tails[m]], k, order[i]) < 0) lo = m + 1;
      else hi = m;
    }
    if (lo > 0) prev.set(i, tails[lo - 1]);
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i: number | undefined = tails[tails.length - 1]; i !== undefined; i = prev.get(i)) keep.add(i);

  const changed = new Map<string, string>();
  let before: string | null = null;
  for (let i = 0; i < order.length; i++) {
    if (keep.has(i)) {
      before = keys.get(order[i])!;
      continue;
    }
    // The next kept key above (or none).
    let after: string | null = null;
    for (let j = i + 1; j < order.length; j++) if (keep.has(j)) { after = keys.get(order[j])!; break; }
    // Two kept nodes with the same key (made by two people at once) leave no room between
    // them: start over with fresh keys for everything.
    if (before !== null && after !== null && before >= after) return fresh(order);
    const k: string = keyBetween(before, after);
    changed.set(order[i], k);
    before = k;
  }
  return changed;
}

/** Keys for every node in `order`, from scratch. */
function fresh(order: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let k: string | null = null;
  for (const id of order) out.set(id, (k = keyBetween(k, null)));
  return out;
}

/** Key order, ties broken by id (two people can make the same key at once). */
export function cmp(ka: string, ida: string, kb: string, idb: string): number {
  return ka < kb ? -1 : ka > kb ? 1 : ida < idb ? -1 : ida > idb ? 1 : 0;
}
