import { expect, test } from "@playwright/test";

// Helpers. Positions are in cells; the app's test bridge converts them to screen pixels.
const at = (page, x, y) => page.evaluate(([x, y]) => window.__asciigraph__.cellCenter(x, y), [x, y]);
const text = (page) => page.evaluate(() => window.__asciigraph__.text());
const state = (page) => page.evaluate(() => window.__asciigraph__.state());
const block = (s) => s.replace(/^\n/, "").replace(/\n\s*$/, "");

async function drag(page, from, to, opts = {}) {
  const s = await at(page, ...from), e = await at(page, ...to);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  // Alt held from after the press: the start attaches as usual, the end stays free.
  if (opts.alt) await page.keyboard.down("Alt");
  await page.mouse.move((s.x + e.x) / 2, (s.y + e.y) / 2, { steps: 3 });
  await page.mouse.move(e.x, e.y, { steps: 3 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up("Alt");
}
async function click(page, x, y) {
  const s = await at(page, x, y);
  await page.mouse.click(s.x, s.y);
}
async function box(page, from, to, label) {
  await page.keyboard.press("b");
  await drag(page, from, to);
  if (label) await page.keyboard.type(label);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape"); // and deselect
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("asciigraph");
  await page.waitForFunction(() => window.__asciigraph__.state().diagramId);
});

test("draw two boxes, connect them, and the connector follows a move", async ({ page }) => {
  await box(page, [2, 2], [12, 4], "A");
  await box(page, [24, 2], [34, 4], "B");
  await page.keyboard.press("a");
  await drag(page, [6, 3], [28, 3]);
  expect(await text(page)).toBe(block(`
┌─────────┐           ┌─────────┐
│    A    ├──────────►│    B    │
└─────────┘           └─────────┘
`));

  // Drag B below A by its interior: the arrow re-routes to come in from the top.
  await page.keyboard.press("Escape");
  await drag(page, [28, 3], [8, 11]);
  expect(await text(page)).toBe(block(`
┌─────────┐
│    A    │
└─────┬───┘
      │
      │
      │
      │
      ▼
  ┌─────────┐
  │    B    │
  └─────────┘
`));

  // Undo puts B back; the diagram survives a reload.
  await page.keyboard.press("Control+z");
  expect(await text(page)).toContain("├──────────►│");
  await page.waitForTimeout(600); // autosave
  await page.reload();
  await page.waitForFunction(() => window.__asciigraph__.state().diagramId);
  expect(await text(page)).toContain("├──────────►│");
});

test("drag an end off a box to detach it, and onto another to attach", async ({ page }) => {
  await box(page, [2, 2], [12, 4], "A");
  await box(page, [24, 2], [34, 4], "B");
  await box(page, [24, 10], [34, 12], "C");
  await page.keyboard.press("a");
  await drag(page, [6, 3], [28, 3]);
  const edgeId = (await state(page)).selection[0];

  // The arrow is selected; its end handle is in the cell left of B. Drag it to empty space.
  await drag(page, [23, 3], [18, 7]);
  let edge = (await state(page)).diagram.edges[edgeId];
  expect(edge.to).toEqual({ kind: "free", at: { x: 18, y: 7 } });

  // Now drag that free end into C: it attaches.
  await drag(page, [18, 7], [29, 11]);
  edge = (await state(page)).diagram.edges[edgeId];
  expect(edge.to.kind).toBe("attached");
  const cId = Object.values((await state(page)).diagram.nodes).find((n) => n.text === "C").id;
  expect(edge.to.node).toBe(cId);
  // C is further across than down, so the arrow comes in from the left.
  expect(await text(page)).toContain("└►│    C    │");
});

test("alt keeps an end free; deleting a box frees its connectors", async ({ page }) => {
  await box(page, [2, 2], [12, 4], "A");
  await page.keyboard.press("l");
  await drag(page, [6, 3], [20, 3]);
  await page.keyboard.press("Escape");
  await box(page, [24, 2], [34, 4], "B");
  await page.keyboard.press("l");
  await drag(page, [28, 3], [28, 3 + 6], { alt: true });
  const d = (await state(page)).diagram;
  const edges = Object.values(d.edges);
  expect(edges[1].from.kind).toBe("attached");
  expect(edges[1].to.kind).toBe("free");

  // Delete A: its line stays, with that end free where it was.
  await page.keyboard.press("Escape");
  await click(page, 6, 3);
  await page.keyboard.press("Delete");
  const after = (await state(page)).diagram;
  expect(Object.keys(after.nodes)).toHaveLength(1);
  expect(Object.values(after.edges)[0].from).toEqual({ kind: "free", at: { x: 13, y: 3 } });
});

test("named boxes, labels and border styles", async ({ page }) => {
  await box(page, [2, 2], [17, 4], "body");
  // Double-click the top border to name it.
  const s = await at(page, 8, 2);
  await page.mouse.dblclick(s.x, s.y);
  await page.keyboard.type("Name");
  await page.keyboard.press("Enter");
  // Double-rule border from the inspector.
  await click(page, 8, 3);
  await page.getByRole("button", { name: "double" }).click();
  // A free label.
  await page.keyboard.press("t");
  await click(page, 2, 7);
  await page.keyboard.type("note");
  await page.keyboard.press("Escape");
  expect(await text(page)).toBe(block(`
╔═ Name ═══════╗
║     body     ║
╚══════════════╝


note
`));
});

test("copy/paste duplicates boxes with their connector; copy gives text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await box(page, [2, 2], [8, 4], "A");
  await box(page, [14, 2], [20, 4], "B");
  await page.keyboard.press("a");
  await drag(page, [4, 3], [16, 3]);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("├────►│");
  await page.keyboard.press("Control+v");
  const d = (await state(page)).diagram;
  expect(Object.keys(d.nodes)).toHaveLength(4);
  expect(Object.keys(d.edges)).toHaveLength(2);
  // The copied arrow joins the copied boxes, not the originals.
  const copies = new Set((await state(page)).selection);
  const newEdge = Object.values(d.edges).find((e) => copies.has(e.id));
  expect(copies.has(newEdge.from.node) && copies.has(newEdge.to.node)).toBe(true);
});

test("a share link opens the diagram as an unsaved copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await box(page, [2, 2], [12, 4], "shared");
  await page.getByTestId("export").click();
  await expect(page.getByTestId("export-text")).toContainText("shared");
  await page.getByRole("button", { name: "copy share link" }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain("#/share/");

  const other = await context.newPage();
  await other.goto(url);
  await other.waitForFunction(() => window.__asciigraph__.state().diagram.order.length === 1);
  expect(await text(other)).toContain("shared");
  await expect(other.getByRole("button", { name: "save a copy" })).toBeVisible();
});

test("tool shortcuts and text editing keys", async ({ page }) => {
  for (const [k, tool] of [["b", "box"], ["a", "arrow"], ["l", "line"], ["t", "text"], ["s", "select"]]) {
    await page.keyboard.press(k);
    expect((await state(page)).tool).toBe(tool);
  }
  await box(page, [2, 2], [12, 5], "");
  await click(page, 6, 3);
  await page.keyboard.press("Enter");
  await page.keyboard.type("bad"); // letters type, not switch tools, while editing
  expect((await state(page)).tool).toBe("select");
  await page.keyboard.press("Escape");
  expect(await text(page)).toContain("bad");
});
