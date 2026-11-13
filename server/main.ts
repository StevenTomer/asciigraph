import { createCollabServer } from "./app";

/** The live-editing server. PORT (default 1234), ASCIIGRAPH_DB (default ./data/asciigraph.db). */
const port = Number(process.env.PORT ?? 1234);
const db = process.env.ASCIIGRAPH_DB ?? "data/asciigraph.db";
const { server } = createCollabServer({ db, port });
await server.listen(port);
console.log(`asciigraph live editing on port ${port}, diagrams in ${db}`);
