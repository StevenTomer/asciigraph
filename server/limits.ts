/**
 * Limits for a live-editing server open to anyone (server/app.ts): how often one address may do
 * something, and slowing down guesses at a password.
 */

/** At most `max` hits per key in each `ms` (a fixed window per key). */
export class RateLimit {
  private hits = new Map<string, { start: number; n: number }>();
  constructor(private max: number, private ms: number) {}

  /** Counts a hit: false if it's over the limit. */
  hit(key: string, now = Date.now()): boolean {
    if (this.max <= 0) return true;
    let h = this.hits.get(key);
    if (!h || now - h.start >= this.ms) {
      h = { start: now, n: 0 };
      this.hits.set(key, h);
      if (this.hits.size > 10_000) this.prune(now);
    }
    h.n++;
    return h.n <= this.max;
  }

  private prune(now: number) {
    for (const [k, h] of this.hits) if (now - h.start >= this.ms) this.hits.delete(k);
  }
}

/** After `free` wrong tries in a row, each further try must wait: 5 s, doubling to 15 min. */
export class Backoff {
  private fails = new Map<string, { n: number; until: number }>();
  constructor(private free = 5, private first = 5000, private most = 15 * 60_000) {}

  /** Still waiting after too many wrong tries? */
  waiting(key: string, now = Date.now()) {
    const f = this.fails.get(key);
    return !!f && now < f.until;
  }

  fail(key: string, now = Date.now()) {
    const f = this.fails.get(key) ?? { n: 0, until: 0 };
    f.n++;
    if (f.n >= this.free) f.until = now + Math.min(this.most, this.first * 2 ** (f.n - this.free));
    this.fails.set(key, f);
    if (this.fails.size > 10_000) for (const [k, v] of this.fails) if (now >= v.until + this.most) this.fails.delete(k);
  }

  succeed(key: string) {
    this.fails.delete(key);
  }
}

/** Who's connecting: the last address in X-Forwarded-For (added by our own proxy) when behind
 * one, else the socket's. */
export function addressOf(forwarded: string | string[] | null | undefined, socket: string | undefined, trustProxy: boolean) {
  const f = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  if (trustProxy && f) {
    const last = f.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return socket ?? "unknown";
}
