# asciigraph

A diagram editor whose output is plain text. Draw boxes, type in them, and connect them with
arrows and lines; connectors attached to a box follow it when it moves. Flowchart shapes
(decision, input/output, start/end), sequence diagrams (lifelines and messages), connector
labels and bend points, auto layout, snapping. Draw from text, kept live: Mermaid sequence
diagrams and flowcharts (or a shorthand like `Client -> API: GET /x`, `A -> B -> C`), and folder
trees. Markdown lists in boxes. Export as text (Unicode box drawing or ASCII), a
Markdown code block, a share link, or JSON.

It's a static web app: run it in a container (below), or build it and serve `dist/` from any
web server or folder.

```
┌─ API ──────────┐        ┌───────────┐
│  orders        ├───────►│ Database  │
└───────┬────────┘        └───────────┘
        │
        ▼
   a free label
```

## How it works

The document is objects, not characters. Nodes (boxes, labels) and edges (connectors) live in an
immutable `Diagram` (`src/model`). Every change re-renders the objects into a character grid:

1. connectors are routed (`src/routing`): each attached end finds its node's side, and an orthogonal
   router finds a path around other nodes;
2. everything is drawn as line strokes (directions per cell) and text into a `CharGrid`;
3. each cell's glyph is looked up from its directions, so junctions like `├ ┬ ┼` come out right.

That grid is what's on the canvas and what's exported, so the output is exactly what you see.
New node kinds (flowchart shapes, sequence-diagram lifelines…) plug in through `src/shapes`.

Diagrams are saved in the browser (localStorage) behind a `DiagramRepository` interface
(`src/storage`), so a server-backed store can be added without changing the editor.

## Running it locally with Docker

```bash
docker compose up -d --build      # or: docker build -t asciigraph . && docker run -d -p 8080:8080 asciigraph
```

Then open http://localhost:8080/. The image builds the app and serves the static files with
nginx (unprivileged, port 8080 inside the container). To use another port, change the left side
of the mapping: `-p 3000:8080`, or `"3000:8080"` in `compose.yaml`. Podman works the same way
(`podman build` / `podman run`).

Diagrams are saved in your browser (localStorage), not in the container. The container holds
no data, so you can rebuild or replace it without losing anything. But a diagram saved at
http://localhost:8080 isn't visible at another address (another host or port).
To move one across, export it as JSON or a share link.

After pulling changes, run `docker compose up -d --build` again to rebuild.

## Developing

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest): rendering goldens, routing, ops, history
npm run e2e          # build, then Playwright (first time: npx playwright install chromium)
npm run build        # typecheck (strict) + production build into dist/ (static files: serve from any folder)
```

## Credits

Text rendering, input handling, the share-link format and fonts are adapted from
[ASCIIFlow](https://github.com/lewish/asciiflow) by Lewis Hemens (MIT). See `LICENSE`.
