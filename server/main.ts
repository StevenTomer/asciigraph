import { dirname, join } from "node:path";
import { DEFAULT_LIMITS, type Limits, backup, createCollabServer } from "./app";

/**
 * The live-editing server.
 *   node server.mjs           run it
 *   node server.mjs backup    copy the database into ASCIIGRAPH_BACKUPS (and keep the newest 14)
 * Settings (environment):
 *   PORT (1234), HOST (all addresses), ASCIIGRAPH_DB (data/asciigraph.db),
 *   ASCIIGRAPH_BACKUPS (a "backups" folder next to the database), ASCIIGRAPH_BACKUPS_KEPT (14),
 *   ASCIIGRAPH_TRUST_PROXY=1 behind a proxy that adds X-Forwarded-For,
 *   ASCIIGRAPH_RETENTION_DAYS (180; 0 keeps diagrams for good), and the other limits as
 *   ASCIIGRAPH_SHARES_PER_HOUR, ASCIIGRAPH_DIAGRAMS_PER_ADDRESS, ASCIIGRAPH_CONNECTS_PER_MINUTE,
 *   ASCIIGRAPH_PEOPLE_PER_DIAGRAM, ASCIIGRAPH_FREE_TRIES, ASCIIGRAPH_MAX_SHARE_BYTES,
 *   ASCIIGRAPH_MAX_DIAGRAM_BYTES (0 turns a limit off).
 */
const env = process.env;
const db = env.ASCIIGRAPH_DB ?? "data/asciigraph.db";

if (process.argv[2] === "backup") {
  const file = backup(db, env.ASCIIGRAPH_BACKUPS ?? join(dirname(db), "backups"), Number(env.ASCIIGRAPH_BACKUPS_KEPT ?? 14));
  console.log(`backed up to ${file}`);
} else {
  const port = Number(env.PORT ?? 1234);
  const limits: Partial<Limits> = {};
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
    const v = env[`ASCIIGRAPH_${key.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase()}`];
    if (v !== undefined && v !== "" && !Number.isNaN(Number(v))) limits[key] = Number(v);
  }
  const { server, sweep } = createCollabServer({ db, port, host: env.HOST || undefined, trustProxy: env.ASCIIGRAPH_TRUST_PROXY === "1", limits });
  await server.listen(port);
  const swept = () => {
    const n = sweep();
    if (n) console.log(`deleted ${n} live diagram(s) nobody had opened for ${limits.retentionDays ?? DEFAULT_LIMITS.retentionDays} days`);
  };
  swept();
  setInterval(swept, 6 * 3600_000).unref();
  console.log(`asciigraph live editing on port ${port}, diagrams in ${db}`);
}
