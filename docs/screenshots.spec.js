// Screenshots for the README and docs, taken from the real app. Run: npm run screenshots
import { test } from "@playwright/test";
import { Base64 } from "js-base64";
import { deflate } from "pako";

const OUT = new URL("./images/", import.meta.url).pathname;
const state = (page) => page.evaluate(() => window.__asciigraph__.state());
const at = (page, x, y) => page.evaluate(([x, y]) => window.__asciigraph__.cellCenter(x, y), [x, y]);

async function open(page, hash = "") {
  await page.goto("/" + hash);
  await page.waitForFunction(() => window.__asciigraph__ && document.querySelector("canvas"));
  await page.waitForTimeout(300);
}

/** Open a diagram (plain JSON) through a share link. */
async function openDiagram(page, diagram, name) {
  const data = Base64.fromUint8Array(deflate(new TextEncoder().encode(JSON.stringify({ name, diagram }))), true);
  await open(page, `#/share/${data}`);
}

async function drawFromText(page, text, choose = []) {
  await page.getByRole("button", { name: "from text" }).click();
  await page.getByLabel("Diagram text").fill(text);
  for (const c of choose) await page.getByRole("button", { name: c, exact: true }).click();
  await page.getByRole("button", { name: "draw", exact: true }).click();
}

/** Click the center of the node whose text starts with `label`. */
async function clickNode(page, label, opts = {}) {
  const s = await state(page);
  const n = Object.values(s.diagram.nodes).find((n) => n.text.startsWith(label));
  const p = await at(page, n.rect.x + Math.floor(n.rect.w / 2), n.rect.y + Math.floor(n.rect.h / 2));
  await page.mouse.click(p.x, p.y, opts);
}

const deselect = (page) => page.keyboard.press("Escape");
const shot = (page, name, clip) => page.screenshot({ path: OUT + name, ...(clip && { clip }) });

const FLOWCHART = `flowchart TD
    A([Start]) --> B[Read order]
    B --> C{In stock?}
    C -->|yes| D[[Ship it]]
    C -->|no| E[(Backorders)]
    D --> F([Done])
    E --> F`;

const SEQUENCE = `sequenceDiagram
    participant C as Client
    participant A as API
    participant D as Database
    C->>+A: GET /orders
    A->>+D: SELECT * FROM orders
    D-->>-A: rows
    Note right of A: cached for 1h
    A-->>-C: 200 OK
    loop every minute
      C-)A: ping
    end
    C-xA: cancel (lost)`;

test("overview: a flowchart with the properties panel", async ({ page }) => {
  await open(page);
  await drawFromText(page, FLOWCHART);
  await deselect(page);
  await clickNode(page, "Ship it");
  await shot(page, "overview.png");
});

test("draw from text dialog", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "from text" }).click();
  await page.getByLabel("Diagram text").fill(SEQUENCE);
  await shot(page, "from-text.png");
});

test("sequence diagram, dark", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "dark" }).click();
  await drawFromText(page, SEQUENCE);
  await deselect(page);
  await shot(page, "sequence-dark.png");
});

test("folder tree as boxes, and as text", async ({ page }) => {
  await open(page);
  const tree = `project/
├── src/
│   ├── main.ts
│   └── util/
│       └── format.ts
├── tests/
│   └── main.test.ts
└── README.md`;
  await drawFromText(page, tree, ["boxes"]);
  await deselect(page);
  await shot(page, "tree.png");
});

test("connector heads", async ({ page }) => {
  const heads = ["arrow", "triangle", "diamond", "hollow-diamond", "dot", "circle", "cross", "bar"];
  const label = { arrow: "arrow", triangle: "hollow arrow", diamond: "diamond", "hollow-diamond": "hollow diamond", dot: "dot", circle: "circle", cross: "cross", bar: "bar" };
  const nodes = {}, edges = {}, order = [];
  const node = (id, x, y, text) => {
    nodes[id] = { id, kind: "box", rect: { x, y, w: 10, h: 3 }, border: "rounded", text, align: { h: "center", v: "middle" } };
    order.push(id);
  };
  heads.forEach((h, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 4 + col * 52, y = 6 + row * 4;
    node(`a${i}`, x, y, "from");
    node(`b${i}`, x + 36, y, "to");
    edges[`e${i}`] = {
      id: `e${i}`, line: "single", label: label[h],
      from: { kind: "attached", node: `a${i}`, side: "auto" }, to: { kind: "attached", node: `b${i}`, side: "auto" },
      arrows: { start: false, end: true }, ...(h !== "arrow" && { heads: { end: h } }),
    };
  });
  // An S-shaped connector, to show where it turns.
  node("s1", 4, 23, "client");
  node("s2", 40, 27, "server");
  edges.s = { id: "s", line: "double", from: { kind: "attached", node: "s1", side: "auto" }, to: { kind: "attached", node: "s2", side: "auto" }, arrows: { start: true, end: true }, heads: { start: "dot" } };
  await openDiagram(page, { version: 1, nodes, edges, order }, "Connector heads");
  const p = await at(page, 17, 24);
  await page.mouse.click(p.x, p.y);
  await shot(page, "heads.png");
});

test("right-click menu", async ({ page }) => {
  await open(page);
  await drawFromText(page, FLOWCHART);
  await deselect(page);
  await page.keyboard.press("Control+a");
  await clickNode(page, "Backorders", { button: "right" });
  await page.waitForTimeout(200);
  await shot(page, "context-menu.png");
});

test("export dialog", async ({ page }) => {
  await open(page);
  await drawFromText(page, FLOWCHART);
  await deselect(page);
  await page.getByTestId("export").click();
  await page.waitForTimeout(200);
  await shot(page, "export.png");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  test("bottom sheet", async ({ page }) => {
    await open(page);
    await drawFromText(page, `flowchart LR
    A[Sign in] --> C[Home]`);
    await deselect(page);
    await clickNode(page, "Home");
    await page.waitForTimeout(400);
    await shot(page, "phone.png");
  });
});
