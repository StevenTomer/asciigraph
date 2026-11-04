import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

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
  // Ctrl: no snapping, for exact positions.
  if (opts.ctrl) await page.keyboard.down("Control");
  await page.mouse.move((s.x + e.x) / 2, (s.y + e.y) / 2, { steps: 3 });
  await page.mouse.move(e.x, e.y, { steps: 3 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up("Alt");
  if (opts.ctrl) await page.keyboard.up("Control");
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
  // Two cells off A's edge is too far to snap: B stays where it's dropped.
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
  await page.keyboard.press("s"); // the arrow tool stays on; switch to select (keeps the selection)

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
  for (const [k, tool] of [["b", "box"], ["a", "arrow"], ["l", "line"], ["t", "text"], ["s", "select"], ["a", "arrow"], [" ", "select"]]) {
    await page.keyboard.press(k);
    expect((await state(page)).tool).toBe(tool);
  }
  await box(page, [2, 2], [12, 5], "");
  await click(page, 6, 3);
  await page.keyboard.press("Enter");
  await page.keyboard.press("b");
  await page.keyboard.type("a d"); // letters and space type, not switch tools, while editing
  expect((await state(page)).editing).not.toBeNull();
  expect((await state(page)).tool).toBe("select");
  await page.keyboard.press("Escape");
  expect(await text(page)).toContain("ba d");
});

test("after drawing a box, clicking away goes to select; Esc keeps the box tool for another", async ({ page }) => {
  await page.keyboard.press("b");
  await drag(page, [2, 2], [10, 4]);
  await page.keyboard.type("one");
  // Clicking away finishes the box and switches to select: no new box.
  await click(page, 20, 12);
  expect((await state(page)).tool).toBe("select");
  expect(Object.keys((await state(page)).diagram.nodes)).toHaveLength(1);
  expect((await state(page)).selection).toEqual([]);

  // Finishing with Esc keeps the box tool on, to draw several in a row.
  await page.keyboard.press("b");
  for (const x of [14, 26]) {
    await drag(page, [x, 2], [x + 8, 4]);
    await page.keyboard.type(`b${x}`);
    await page.keyboard.press("Escape"); // finish typing
    expect((await state(page)).tool).toBe("box");
  }
  expect(Object.keys((await state(page)).diagram.nodes)).toHaveLength(3);
  expect(await text(page)).toContain("b26");
  await page.keyboard.press("Escape"); // back to select
  expect((await state(page)).tool).toBe("select");

  // Clicking away onto a box selects it.
  await page.keyboard.press("b");
  await drag(page, [2, 8], [10, 10]);
  await page.keyboard.type("four");
  await click(page, 6, 3);
  const s = await state(page);
  expect(s.tool).toBe("select");
  expect(s.selection.map((id) => s.diagram.nodes[id].text)).toEqual(["one"]);
});

test("after a label or connector, clicking away goes to select", async ({ page }) => {
  // Text: type a label, click away: done, in select, and no second label.
  await page.keyboard.press("t");
  await click(page, 4, 4);
  await page.keyboard.type("note");
  await click(page, 20, 12);
  let s = await state(page);
  expect(s.tool).toBe("select");
  expect(Object.values(s.diagram.nodes).map((n) => n.text)).toEqual(["note"]);

  // Arrow and line: draw one (the tool stays on for another), then a click on empty space.
  for (const key of ["a", "l"]) {
    await page.keyboard.press(key);
    await drag(page, [4, 16], [20, 16]);
    expect((await state(page)).tool).not.toBe("select");
    await click(page, 30, 20);
    s = await state(page);
    expect(s.tool).toBe("select");
    expect(s.selection).toEqual([]);
  }
  expect(Object.keys((await state(page)).diagram.edges)).toHaveLength(2);
});

test("normalize sizes and shrink to text, from the right-click menu", async ({ page }) => {
  await box(page, [2, 2], [10, 4], "a");
  await box(page, [14, 2], [34, 8], "longer text");
  await page.keyboard.press("Control+a");
  const r = await at(page, 20, 5);
  await page.mouse.click(r.x, r.y, { button: "right" });
  await page.getByRole("menuitem", { name: /Normalize Size/ }).hover();
  await page.getByRole("menuitem", { name: /^Width/ }).click();
  const rects = async () => Object.values((await state(page)).diagram.nodes).map((n) => [n.rect.w, n.rect.h]);
  expect(await rects()).toEqual([[21, 3], [21, 7]]);

  await page.mouse.click(r.x, r.y, { button: "right" });
  await page.getByRole("menuitem", { name: /Shrink to Text/ }).click();
  expect(await rects()).toEqual([[5, 3], [15, 3]]);
  expect(await text(page)).toContain("│ longer text │");
});

test("boxes inside a box move with it; alt-drag or 'stays put' moves it alone", async ({ page }) => {
  // Draw the inner boxes first, then a frame around them: they must stay visible and clickable.
  await box(page, [4, 4], [12, 6], "in1");
  await box(page, [18, 4], [26, 6], "in2");
  await page.keyboard.press("a");
  await drag(page, [8, 5], [22, 5]);
  await page.keyboard.press("Escape");
  await box(page, [2, 2], [30, 8], "");
  expect(await text(page)).toContain("│  in1  ├────►│  in2  │");
  await click(page, 8, 5);
  const nodes = (await state(page)).diagram.nodes;
  const in1 = Object.values(nodes).find((n) => n.text === "in1");
  const frame = Object.values(nodes).find((n) => n.rect.w === 29);
  expect((await state(page)).selection).toEqual([in1.id]);

  // Drag the frame by its border: everything inside comes along, arrow included.
  await page.keyboard.press("Escape");
  const before = await text(page);
  await drag(page, [16, 2], [16, 12], { ctrl: true });
  expect(await text(page)).toBe(before); // same drawing, just lower (text is trimmed to the drawing)
  let d = (await state(page)).diagram;
  expect(d.nodes[frame.id].rect.y).toBe(12);
  expect(d.nodes[in1.id].rect.y).toBe(14);

  // Alt-drag: only the frame moves.
  await drag(page, [16, 12], [16, 13], { alt: true, ctrl: true });
  d = (await state(page)).diagram;
  expect(d.nodes[frame.id].rect.y).toBe(13);
  expect(d.nodes[in1.id].rect.y).toBe(14);

  // "inside: stays put" makes that the box's default.
  await page.keyboard.press("Control+z");
  await click(page, 16, 12);
  await page.getByRole("button", { name: "stays put" }).click();
  await drag(page, [16, 12], [16, 11], { ctrl: true });
  d = (await state(page)).diagram;
  expect(d.nodes[frame.id].rect.y).toBe(11);
  expect(d.nodes[in1.id].rect.y).toBe(14);
});

test("in box mode, clicking a box selects it; dragging inside one draws a nested box", async ({ page }) => {
  await page.keyboard.press("b");
  await drag(page, [2, 2], [30, 10]);
  await page.keyboard.press("Escape"); // finish typing; still in box mode
  const outer = (await state(page)).diagram.order[0];
  await page.keyboard.press("Escape"); // deselect, back to select…
  await page.keyboard.press("b"); // …and into box mode again

  await click(page, 16, 6);
  let s = await state(page);
  expect(s.tool).toBe("select");
  expect(s.selection).toEqual([outer]);
  expect(s.diagram.order).toHaveLength(1);

  await page.keyboard.press("b");
  await drag(page, [5, 4], [14, 7]);
  s = await state(page);
  expect(s.tool).toBe("box");
  expect(s.diagram.order).toHaveLength(2);
});

test("in arrow, line and text mode, clicking a box or connector selects it", async ({ page }) => {
  await box(page, [2, 2], [12, 4], "A");
  await box(page, [24, 2], [34, 4], "B");
  for (const tool of ["a", "l", "t"]) {
    await page.keyboard.press(tool);
    await click(page, 6, 3);
    const s = await state(page);
    expect(s.tool).toBe("select");
    expect(s.selection).toHaveLength(1);
    expect(s.diagram.nodes[s.selection[0]].text).toBe("A");
    expect(Object.keys(s.diagram.edges)).toHaveLength(0);
  }
  // Dragging from a box still draws a connector, and the tool stays on.
  await page.keyboard.press("a");
  await drag(page, [6, 3], [28, 3]);
  let s = await state(page);
  const edge = s.selection[0];
  expect(s.tool).toBe("arrow");
  expect(s.diagram.edges[edge]).toBeDefined();
  // Clicking the connector itself selects it.
  await page.keyboard.press("Escape");
  await page.keyboard.press("l");
  await click(page, 18, 3);
  s = await state(page);
  expect(s.tool).toBe("select");
  expect(s.selection).toEqual([edge]);
});

test("text mode: click-drag on a box moves it; clicking empty space still makes a label", async ({ page }) => {
  await box(page, [2, 2], [12, 4], "A");
  await page.keyboard.press("t");
  await drag(page, [6, 3], [6, 8]);
  let s = await state(page);
  expect(s.tool).toBe("select");
  expect(Object.values(s.diagram.nodes)[0].rect.y).toBe(7);
  await page.keyboard.press("t");
  await click(page, 20, 2);
  await page.keyboard.type("label");
  await page.keyboard.press("Escape");
  s = await state(page);
  expect(s.tool).toBe("text");
  expect(await text(page)).toContain("label");
});

test("text mode: alt-click places a label inside a box, which then moves with it", async ({ page }) => {
  await box(page, [2, 2], [20, 8], "");
  await page.keyboard.press("t");
  const p = await at(page, 5, 4);
  await page.keyboard.down("Alt");
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up("Alt");
  await page.keyboard.type("inside");
  await page.keyboard.press("Escape");
  let s = await state(page);
  expect(s.tool).toBe("text");
  const label = Object.values(s.diagram.nodes).find((n) => n.text === "inside");
  expect(label.rect).toMatchObject({ x: 5, y: 4 });
  expect(await text(page)).toContain("│  inside");

  // Move the box: the label goes with it.
  await page.keyboard.press("Escape");
  await drag(page, [12, 2], [12, 12]);
  s = await state(page);
  expect(s.diagram.nodes[label.id].rect).toMatchObject({ x: 5, y: 14 });
});

test("right-click menu: arrange, align, distribute", async ({ page }) => {
  await box(page, [2, 2], [10, 4], "A");
  await box(page, [16, 6], [28, 10], "B");
  await box(page, [40, 3], [46, 5], "C");
  const ids = Object.fromEntries(Object.values((await state(page)).diagram.nodes).map((n) => [n.text, n.id]));
  const rect = async (t) => (await state(page)).diagram.nodes[ids[t]].rect;
  const menu = async (x, y) => {
    const p = await at(page, x, y);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await expect(page.getByRole("menu").first()).toBeVisible();
  };

  // Right-click a box: it's selected, and the menu has the arrange items (no Align for one box).
  await menu(20, 8);
  expect((await state(page)).selection).toEqual([ids.B]);
  await expect(page.getByRole("menuitem", { name: "Send to Back" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Align" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Send to Back" }).click();
  expect((await state(page)).diagram.order[0]).toBe(ids.B);
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Select all three, then Align ▸ Align Top.
  await page.keyboard.press("Control+a");
  await menu(20, 8);
  expect((await state(page)).selection).toHaveLength(3); // right-click inside the selection keeps it
  await page.getByRole("menuitem", { name: "Align", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Align Top" }).click();
  expect((await rect("A")).y).toBe(2);
  expect((await rect("B")).y).toBe(2);
  expect((await rect("C")).y).toBe(2);

  // Distribute ▸ Distribute Horizontally: equal gaps, A and C stay put.
  await menu(20, 4);
  await page.getByRole("menuitem", { name: "Distribute", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Distribute Horizontally" }).click();
  const [a, b, c] = [await rect("A"), await rect("B"), await rect("C")];
  expect(a.x).toBe(2);
  expect(c.x).toBe(40);
  expect(b.x - (a.x + a.w)).toBe(c.x - (b.x + b.w));

  // Esc closes the menu without clearing the selection; Ctrl+Z undoes the last arrangement.
  await menu(20, 4);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect((await state(page)).selection).toHaveLength(3);
  await page.keyboard.press("Control+z");
  expect((await rect("B")).x).toBe(16);

  // Right-click empty space: selection cleared, menu offers Paste / Select All.
  await menu(30, 20);
  expect((await state(page)).selection).toEqual([]);
  await expect(page.getByRole("menuitem", { name: "Select All" })).toBeVisible();
});

test("keyboard: Ctrl+] / Ctrl+Shift+[ reorder, Ctrl+D duplicates", async ({ page }) => {
  await box(page, [2, 2], [10, 5], "A");
  await box(page, [6, 3], [14, 6], "B");
  const order = async () => (await state(page)).diagram.order;
  const [a, b] = await order();
  await click(page, 3, 3); // A's visible part
  await page.keyboard.press("Control+]");
  expect(await order()).toEqual([b, a]);
  await page.keyboard.press("Control+Shift+[");
  expect(await order()).toEqual([a, b]);
  await page.keyboard.press("Control+d");
  expect(await order()).toHaveLength(3);
});

test("right-click menu works from the keyboard", async ({ page }) => {
  await box(page, [2, 2], [12, 4], "A");
  const p = await at(page, 6, 3);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.keyboard.press("ArrowDown"); // into the menu: first item
  await expect(page.getByRole("menuitem", { name: "Edit Text" })).toBeFocused();
  await page.keyboard.press("Enter");
  expect((await state(page)).editing).not.toBeNull();
});

test("properties panel: stacking order buttons", async ({ page }) => {
  await box(page, [2, 2], [10, 5], "A");
  await box(page, [6, 3], [14, 6], "B");
  await box(page, [10, 4], [18, 7], "C");
  const [a, b, c] = (await state(page)).diagram.order;
  const order = async () => (await state(page)).diagram.order;
  await click(page, 16, 6); // C
  await page.getByRole("button", { name: "backward", exact: true }).click();
  expect(await order()).toEqual([a, c, b]);
  await page.getByRole("button", { name: "to back" }).click();
  expect(await order()).toEqual([c, a, b]);
  await page.getByRole("button", { name: "forward", exact: true }).click();
  expect(await order()).toEqual([a, c, b]);
  await page.getByRole("button", { name: "to front" }).click();
  expect(await order()).toEqual([a, b, c]);
});

test("middle-drag pans without pasting (Linux primary-selection paste is ignored)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await box(page, [2, 2], [10, 4], "A");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  const before = (await state(page)).view;
  const p = await at(page, 20, 10);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(p.x - 100, p.y - 50, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  // What the browser does next on Linux: a paste event carrying the primary selection.
  await page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData("text/plain", t);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, await page.evaluate(() => navigator.clipboard.readText()));
  const after = await state(page);
  expect(after.view.x).toBeGreaterThan(before.x);
  expect(Object.keys(after.diagram.nodes)).toHaveLength(1);
  // A real Ctrl+V a moment later still pastes.
  await page.waitForTimeout(600);
  await page.keyboard.press("Control+v");
  expect(Object.keys((await state(page)).diagram.nodes)).toHaveLength(2);
});

test("a connector inside a box can be clicked and selected", async ({ page }) => {
  await box(page, [2, 2], [30, 9], "");
  await box(page, [4, 4], [10, 6], "in1");
  await box(page, [20, 4], [26, 6], "in2");
  await page.keyboard.press("a");
  await drag(page, [7, 5], [23, 5]);
  await page.keyboard.press("Escape");
  const edgeId = Object.keys((await state(page)).diagram.edges)[0];
  await click(page, 15, 5); // on the arrow, inside the outer box
  expect((await state(page)).selection).toEqual([edgeId]);
  await click(page, 15, 7); // empty space inside the outer box: the box
  const outer = (await state(page)).diagram.order[0];
  expect((await state(page)).selection).toEqual([outer]);
});

test("connector labels and bend points", async ({ page }) => {
  await box(page, [2, 2], [10, 4], "A");
  await box(page, [30, 2], [38, 4], "B");
  await page.keyboard.press("a");
  await drag(page, [6, 3], [34, 3]);
  await page.keyboard.press("s");
  const id = (await state(page)).selection[0];
  const edge = async () => (await state(page)).diagram.edges[id];

  // Double-click the line to label it.
  const p = await at(page, 20, 3);
  await page.mouse.dblclick(p.x, p.y);
  await page.keyboard.type("calls");
  await page.keyboard.press("Enter");
  expect((await edge()).label).toBe("calls");
  expect(await text(page)).toMatch(/├─+ calls ─+►│/);

  // Drag the selected line down: a bend point; the route goes through it.
  await click(page, 14, 3);
  await drag(page, [14, 3], [14, 9]);
  expect((await edge()).via).toEqual([{ x: 14, y: 9 }]);
  expect((await text(page)).split("\n").length).toBeGreaterThan(5);

  // Move it, then double-click it to remove it.
  await drag(page, [14, 9], [20, 8]);
  expect((await edge()).via).toEqual([{ x: 20, y: 8 }]);
  const v = await at(page, 20, 8);
  await page.mouse.dblclick(v.x, v.y);
  expect((await edge()).via).toBeUndefined();

  // A plain click on the selected line adds nothing; Enter edits the label.
  await click(page, 14, 3);
  expect((await edge()).via).toBeUndefined();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("uses");
  await page.keyboard.press("Enter");
  expect((await edge()).label).toBe("uses");
});

test("zoom controls and shortcuts", async ({ page }) => {
  await box(page, [2, 2], [12, 4], "A");
  await box(page, [60, 30], [70, 32], "far");
  const zoom = async () => (await state(page)).view.zoom;
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect(await zoom()).toBeCloseTo(1.25, 1);
  await expect(page.getByTestId("zoom-level")).toHaveText("125%");
  await page.keyboard.press("Control+-");
  await page.keyboard.press("Control+-");
  expect(await zoom()).toBeCloseTo(0.9, 1);
  await page.getByRole("button", { name: "Reset zoom" }).click();
  expect(await zoom()).toBe(1);
  await expect(page.getByTestId("zoom-level")).toHaveText("100%");
  // Fit: both boxes on screen.
  await page.keyboard.press("Shift+1");
  const far = await at(page, 70, 32);
  const near = await at(page, 2, 2);
  const vp = page.viewportSize();
  expect(far.x).toBeLessThan(vp.width);
  expect(far.y).toBeLessThan(vp.height);
  expect(near.x).toBeGreaterThan(0);
});

test("moving a box snaps it into line with another, unless Ctrl is held", async ({ page }) => {
  await box(page, [2, 2], [12, 8], "A"); // rows 2, 5 (middle), 8
  await box(page, [20, 12], [30, 15], "B"); // 4 tall: no middle row
  const b = Object.values((await state(page)).diagram.nodes).find((n) => n.text === "B");
  // Drag B so its top lands one row below A's top: it snaps up to A's top.
  await drag(page, [25, 13], [25, 4]);
  expect((await state(page)).diagram.nodes[b.id].rect.y).toBe(2);
  // With Ctrl held, no snapping.
  await drag(page, [25, 3], [25, 4], { ctrl: true });
  expect((await state(page)).diagram.nodes[b.id].rect.y).toBe(3);
});

test("undo history survives a reload", async ({ page }) => {
  await box(page, [2, 2], [12, 4], "A");
  await box(page, [20, 2], [30, 4], "B");
  await page.waitForTimeout(600); // autosave
  await page.reload();
  await page.waitForFunction(() => window.__asciigraph__.state().diagramId);
  expect(Object.keys((await state(page)).diagram.nodes)).toHaveLength(2);
  await page.keyboard.press("Control+z");
  expect(Object.keys((await state(page)).diagram.nodes)).toHaveLength(1);
  await page.keyboard.press("Control+Shift+z");
  expect(Object.keys((await state(page)).diagram.nodes)).toHaveLength(2);
});

test("shape picker draws flowchart shapes; lifelines get horizontal messages", async ({ page }) => {
  await page.keyboard.press("b");
  await expect(page.getByRole("toolbar", { name: "Shape" })).toBeVisible();
  const picker = page.getByRole("toolbar", { name: "Shape" });
  await picker.getByRole("button", { name: "decision" }).click();
  await drag(page, [2, 2], [17, 6]);
  await page.keyboard.type("ok?");
  await page.keyboard.press("Escape");
  expect(Object.values((await state(page)).diagram.nodes)[0].kind).toBe("decision");
  expect(await text(page)).toContain("<     ok?      >");

  // Two lifelines, then a message: it lands on the same row even if dropped a little lower.
  await picker.getByRole("button", { name: "lifeline" }).click();
  await drag(page, [2, 10], [13, 25]);
  await page.keyboard.press("Escape");
  await drag(page, [24, 10], [35, 25]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("a");
  await drag(page, [7, 16], [29, 18]);
  const msg = Object.values((await state(page)).diagram.edges)[0];
  expect(msg.from.offset).toBe(6);
  expect(msg.to.offset).toBe(6);
  expect(await text(page)).toMatch(/├─+►┆/);
});

test("right-click Auto Layout arranges the diagram", async ({ page }) => {
  await box(page, [30, 2], [36, 4], "a");
  await box(page, [2, 12], [8, 14], "b");
  await box(page, [50, 20], [56, 22], "c");
  await page.keyboard.press("l");
  await drag(page, [33, 3], [5, 13]);
  await drag(page, [5, 13], [53, 21]);
  await page.keyboard.press("Escape");
  const p = await at(page, 20, 30);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Auto Layout" }).hover();
  await page.getByRole("menuitem", { name: "Top to Bottom (TB)" }).click();
  const n = Object.values((await state(page)).diagram.nodes);
  const y = (t) => n.find((x) => x.text === t).rect.y;
  expect(y("a")).toBeLessThan(y("b"));
  expect(y("b")).toBeLessThan(y("c"));
});

test("drag a connector's label along it", async ({ page }) => {
  await box(page, [2, 2], [8, 4], "A");
  await box(page, [40, 2], [46, 4], "B");
  await page.keyboard.press("a");
  await drag(page, [5, 3], [43, 3]);
  await page.keyboard.press("s");
  const id = (await state(page)).selection[0];
  await page.keyboard.press("Enter");
  await page.keyboard.type("go");
  await page.keyboard.press("Enter");
  const row = async () => (await text(page)).split("\n")[1];
  const before = (await row()).indexOf(" go ");
  // Drag the label (centered, around column 24) towards A.
  await drag(page, [24, 3], [14, 3]);
  expect((await state(page)).diagram.edges[id].labelAt).toBeLessThan(0.5);
  expect((await row()).indexOf(" go ")).toBeLessThan(before - 5);
  // Right-click: Reset Label Position puts it back.
  const p = await at(page, 30, 3);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Reset Label Position" }).click();
  expect((await row()).indexOf(" go ")).toBe(before);
});

test("activation bars sit on a lifeline and take messages at the row", async ({ page }) => {
  const picker = page.getByRole("toolbar", { name: "Shape" });
  await page.keyboard.press("b");
  await picker.getByRole("button", { name: "lifeline" }).click();
  await drag(page, [2, 2], [13, 20]);
  await page.keyboard.press("Escape");
  await drag(page, [24, 2], [35, 20]);
  await page.keyboard.press("Escape");
  // Draw an activation bar a little off the second lifeline's line: it centers on it.
  await picker.getByRole("button", { name: "activation" }).click();
  await drag(page, [30, 8], [31, 14]);
  await page.keyboard.press("Escape");
  const nodes = Object.values((await state(page)).diagram.nodes);
  const act = nodes.find((n) => n.kind === "activation");
  expect(act.rect).toMatchObject({ x: 28, w: 3, y: 8, h: 7 });
  // A message from the first lifeline onto the bar: horizontal, at the row it started.
  await page.keyboard.press("a");
  await drag(page, [7, 10], [29, 12]);
  const msg = Object.values((await state(page)).diagram.edges)[0];
  expect(msg.to.node).toBe(act.id);
  expect(act.rect.y + msg.to.offset).toBe(10);
  expect(await text(page)).toMatch(/├─+►│ │/);
});

test("draw a sequence from Mermaid text; edits redraw, keeping a moved lifeline", async ({ page }) => {
  await page.getByRole("button", { name: "from text" }).click();
  const dialog = page.getByRole("dialog", { name: "Draw from text" });
  await dialog.getByLabel("Diagram text").fill("sequenceDiagram\nparticipant C as Client\nC->>API: GET /x\nAPI-->>C: 200");
  await expect(dialog.getByRole("button", { name: /auto: message sequence/ })).toBeVisible();
  await expect(dialog.getByTestId("source-preview")).toContainText("GET /x");
  await dialog.getByRole("button", { name: "draw" }).click();
  await expect(dialog).toHaveCount(0);
  let s = await state(page);
  expect(Object.values(s.diagram.nodes).map((n) => n.text).sort()).toEqual(["API", "Client"]);
  expect(s.selection.length).toBe(4);

  // Move the API lifeline right by its header, then edit the text.
  const api = Object.values(s.diagram.nodes).find((n) => n.text === "API");
  const hx = api.rect.x + 2, hy = api.rect.y + 1;
  await page.keyboard.press("Escape");
  await drag(page, [hx, hy], [hx + 8, hy], { ctrl: true });
  const moved = (await state(page)).diagram.nodes[api.id].rect;
  await click(page, hx + 8, hy);
  await page.getByRole("button", { name: "edit text" }).click();
  const edit = page.getByRole("dialog", { name: "Edit source text" });
  await edit.getByLabel("Diagram text").fill("sequenceDiagram\nparticipant C as Client\nC->>API: GET /x\nAPI-->>C: 200\nC->>API: bye");
  await edit.getByRole("button", { name: "update" }).click();
  s = await state(page);
  expect(s.diagram.nodes[api.id].rect.x).toBe(moved.x);
  expect(Object.keys(s.diagram.edges)).toHaveLength(3);
  expect(await text(page)).toContain("bye");
});

test("draw a graph from shorthand, left to right, and a folder tree as boxes", async ({ page }) => {
  await page.getByRole("button", { name: "from text" }).click();
  let dialog = page.getByRole("dialog", { name: "Draw from text" });
  await dialog.getByLabel("Diagram text").fill("A -> B -> C\nA -> D -> C");
  await dialog.getByRole("button", { name: "left to right" }).click();
  await dialog.getByRole("button", { name: "draw" }).click();
  const n = Object.values((await state(page)).diagram.nodes);
  const x = (t) => n.find((v) => v.text === t).rect.x;
  expect(x("A")).toBeLessThan(x("B"));
  expect(x("B")).toBeLessThan(x("C"));

  // Right-click empty space → Draw from Text…
  await page.keyboard.press("Escape");
  const p = await at(page, 5, 28);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Draw from Text…" }).click();
  dialog = page.getByRole("dialog", { name: "Draw from text" });
  await dialog.getByLabel("Diagram text").fill("app/src/main.ts\napp/README.md");
  await expect(dialog.getByRole("button", { name: /auto: folder tree/ })).toBeVisible();
  await dialog.getByRole("button", { name: "boxes" }).click();
  await dialog.getByRole("button", { name: "draw" }).click();
  expect(await text(page)).toContain("│ main.ts │");
});

test("markdown lists in a box", async ({ page }) => {
  await page.keyboard.press("b");
  await drag(page, [2, 2], [26, 4]);
  await page.keyboard.type("Plan:\n- design\n- build\n  1. parse\n  1. draw");
  await page.keyboard.press("Escape");
  const t = await text(page);
  expect(t).toContain("│ • design");
  expect(t).toContain("│   2. draw");
});

test("edit a hand-drawn graph as text", async ({ page }) => {
  await box(page, [2, 2], [12, 4], "Start");
  await box(page, [30, 2], [42, 4], "Check");
  await page.keyboard.press("a");
  await drag(page, [6, 3], [36, 3]);
  await page.keyboard.press("Control+a");
  const before = (await state(page)).diagram;
  const start = Object.values(before.nodes).find((n) => n.text === "Start");
  const p = await at(page, 36, 3);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Edit as Text…" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit as text" });
  const field = dialog.getByLabel("Diagram text");
  await expect(field).toHaveValue(/flowchart LR\n  Start\[Start\]\n  Check\[Check\]\n  Start --> Check/);
  // Rename Check over several lines with a list, and add a node.
  await field.fill('flowchart LR\n  Start[Start]\n  Check["`Check:\n  - stock\n  - price`"]\n  Start --> Check\n  Check --> Done([Done])');
  await dialog.getByRole("button", { name: "update" }).click();
  const after = (await state(page)).diagram;
  expect(after.nodes[start.id].rect).toEqual(start.rect); // kept its place
  expect(await text(page)).toContain("• stock");
  expect(Object.values(after.nodes).some((n) => n.text === "Done" && n.kind === "terminal")).toBe(true);
  // Now it's linked: the panel offers its text.
  await expect(page.getByRole("button", { name: "edit text" })).toBeVisible();
});

test("edit a hand-drawn sequence diagram as text", async ({ page }) => {
  const picker = page.getByRole("toolbar", { name: "Shape" });
  await page.keyboard.press("b");
  await picker.getByRole("button", { name: "lifeline" }).click();
  await drag(page, [2, 2], [13, 18]);
  await page.keyboard.type("Client");
  await page.keyboard.press("Escape");
  await drag(page, [26, 2], [37, 18]);
  await page.keyboard.type("Server");
  await page.keyboard.press("Escape");
  await page.keyboard.press("a");
  await drag(page, [7, 9], [31, 9]);
  await page.keyboard.press("Enter");
  await page.keyboard.type("hello");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "edit as text" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit as text" });
  const field = dialog.getByLabel("Diagram text");
  await expect(field).toHaveValue("sequenceDiagram\n  participant Client\n  participant Server\n  Client->>Server: hello");
  await field.fill("sequenceDiagram\n  participant Client\n  participant Server\n  Client->>Server: hello\n  Server-->>Client: hi back");
  await dialog.getByRole("button", { name: "update" }).click();
  expect(await text(page)).toContain("hi back");
  expect(Object.keys((await state(page)).diagram.edges)).toHaveLength(2);
});

test("multi-line connector labels: Shift+Enter for a new line", async ({ page }) => {
  await box(page, [2, 2], [8, 4], "A");
  await box(page, [40, 2], [46, 4], "B");
  await page.keyboard.press("a");
  await drag(page, [5, 3], [43, 3]);
  await page.keyboard.press("Enter");
  await page.keyboard.type("first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second");
  await page.keyboard.press("Enter");
  const edge = Object.values((await state(page)).diagram.edges)[0];
  expect(edge.label).toBe("first\nsecond");
  const lines = (await text(page)).split("\n");
  expect(lines[1]).toContain(" first ");
  expect(lines[2]).toContain("second");
});

test("Alt, Ctrl or the snap toggle place a box freely", async ({ page }) => {
  await box(page, [2, 2], [12, 8], "A"); // rows 2, 5 (middle), 8
  await box(page, [20, 12], [30, 15], "B"); // 4 tall: no middle row
  const b = Object.values((await state(page)).diagram.nodes).find((n) => n.text === "B");
  const y = async () => (await state(page)).diagram.nodes[b.id].rect.y;
  // Dropped one row below A's top, it snaps up to it…
  await drag(page, [25, 13], [25, 4]);
  expect(await y()).toBe(2);
  // …but not with Alt held…
  await drag(page, [25, 3], [25, 4], { alt: true });
  expect(await y()).toBe(3);
  // …nor with snapping turned off.
  await drag(page, [25, 4], [25, 2]);
  expect(await y()).toBe(2);
  await page.getByRole("button", { name: "snap" }).click();
  await drag(page, [25, 3], [25, 4]);
  expect(await y()).toBe(3);
  expect((await state(page)).snap).toBe(false);
});

test("export as comment blocks for source code, and a custom style", async ({ page }) => {
  await box(page, [2, 2], [8, 4], "A");
  await page.getByTestId("export").click();
  const preview = page.getByTestId("export-text");
  const format = page.getByRole("group", { name: "Format" });
  await format.getByRole("button", { name: "C/C++ /* */" }).click();
  await expect(preview).toHaveText("/*\n * ┌─────┐\n * │  A  │\n * └─────┘\n */");
  await format.getByRole("button", { name: "C/C++ //" }).click();
  await expect(preview).toHaveText(/^\/\/ ┌─────┐/);
  await format.getByRole("button", { name: "Python #" }).click();
  await expect(page.getByRole("button", { name: "download .py" })).toBeVisible();
  await format.getByRole("button", { name: "custom" }).click();
  await page.getByLabel("First line").fill("<!--");
  await page.getByLabel("Line prefix").fill("  ");
  await page.getByLabel("Last line").fill("-->");
  await expect(preview).toHaveText("<!--\n  ┌─────┐\n  │  A  │\n  └─────┘\n-->");
  // Remembered next time.
  await page.keyboard.press("Escape");
  await page.getByTestId("export").click();
  await expect(page.getByTestId("export-text")).toHaveText(/^<!--/);
});

test("switch a drawn graph between top-to-bottom and left-to-right", async ({ page }) => {
  await page.getByRole("button", { name: "from text" }).click();
  const dialog = page.getByRole("dialog", { name: "Draw from text" });
  await dialog.getByLabel("Diagram text").fill("flowchart TD\n  A --> B --> C");
  await dialog.getByRole("button", { name: "draw" }).click();
  const pos = async () => {
    const n = Object.values((await state(page)).diagram.nodes);
    return Object.fromEntries(n.map((v) => [v.text, v.rect]));
  };
  let p = await pos();
  expect(p.A.y).toBeLessThan(p.B.y);
  // Everything drawn is selected: the panel offers the layout direction.
  await page.getByRole("button", { name: "left to right (LR)" }).click();
  p = await pos();
  expect(p.A.x).toBeLessThan(p.B.x);
  expect(p.A.y).toBe(p.C.y);
  expect(Object.values((await state(page)).diagram.sources)[0].text).toMatch(/^flowchart LR/);
  // And back from the right-click menu.
  const c = await at(page, p.B.x + 2, p.B.y + 1);
  await page.mouse.click(c.x, c.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Layout", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Top to Bottom (TB)" }).click();
  p = await pos();
  expect(p.A.y).toBeLessThan(p.B.y);
});

test("lock boxes together horizontally; Alt moves one alone; unlock", async ({ page }) => {
  await box(page, [2, 2], [10, 4], "A");
  await box(page, [2, 12], [10, 14], "B");
  const ids = Object.fromEntries(Object.values((await state(page)).diagram.nodes).map((n) => [n.text, n.id]));
  const rect = async (t) => (await state(page)).diagram.nodes[ids[t]].rect;
  await page.keyboard.press("Control+a");
  const p = await at(page, 6, 3);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Lock Together" }).hover();
  await page.getByRole("menuitem", { name: /^Horizontally/ }).click();
  await expect(page.getByText("2 together, left–right")).toBeVisible();

  // Drag A right and down: B follows left–right only.
  await page.keyboard.press("Escape");
  await drag(page, [6, 3], [14, 5], { ctrl: true });
  expect(await rect("A")).toMatchObject({ x: 10, y: 4 });
  expect(await rect("B")).toMatchObject({ x: 10, y: 12 });
  // Alt: A alone.
  await drag(page, [14, 5], [18, 5], { alt: true });
  expect((await rect("A")).x).toBe(14);
  expect((await rect("B")).x).toBe(10);
  // Unlock from the properties panel: A moves alone.
  await click(page, 18, 5);
  await page.getByRole("button", { name: "unlock" }).click();
  await drag(page, [18, 5], [20, 5], { ctrl: true });
  expect((await rect("B")).x).toBe(10);
});

test.describe("properties panel", () => {
  const shots = process.env.SHOTS; // a directory to save screenshots in, when set

  test("is a bottom sheet on a phone, with the zoom controls above it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await box(page, [2, 14], [14, 18], "phone");
    await click(page, 8, 16);
    const panel = page.getByRole("complementary", { name: "Properties" });
    await expect(panel).toBeVisible();
    const p = await panel.boundingBox();
    expect(p.x).toBe(0);
    expect(p.width).toBe(390);
    expect(Math.round(p.y + p.height)).toBe(844);
    expect(p.height).toBeLessThanOrEqual(844 * 0.45 + 1);
    const z = await page.getByRole("group", { name: "Zoom" }).boundingBox();
    expect(z.y + z.height).toBeLessThanOrEqual(p.y);
    if (shots) await page.screenshot({ path: `${shots}/phone-open.png` });

    // Collapse to the title bar: the zoom controls follow it down, and it stays collapsed.
    await panel.locator(".panel-head").click();
    await expect(panel.getByText("border")).toHaveCount(0);
    const c = await panel.boundingBox();
    expect(c.height).toBeLessThan(60);
    await expect.poll(async () => (await page.getByRole("group", { name: "Zoom" }).boundingBox()).y).toBeGreaterThan(p.y);
    if (shots) await page.screenshot({ path: `${shots}/phone-collapsed.png` });
    await page.reload();
    await page.waitForFunction(() => window.__asciigraph__.state().diagramId);
    await click(page, 8, 16);
    await expect(panel.locator(".panel-head")).toHaveAttribute("aria-expanded", "false");
    await panel.locator(".panel-head").click();
    await expect(panel.getByText("border")).toBeVisible();
  });

  test("on a phone, scrolls the selection out from under the sheet; drags still land exactly", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await box(page, [2, 28], [14, 32], "low");
    const rect = async () => Object.values((await state(page)).diagram.nodes)[0].rect;
    const viewY = async () => (await state(page)).view.y;
    const y0 = await viewY();
    await click(page, 8, 30);
    const panel = page.getByRole("complementary", { name: "Properties" });
    await expect(panel).toBeVisible();
    await expect.poll(viewY).toBeGreaterThan(y0);
    const p = await panel.boundingBox();
    const r = await rect();
    expect((await at(page, r.x, r.y + r.h - 1)).y).toBeLessThan(p.y);
    if (shots) await page.screenshot({ path: `${shots}/phone-revealed.png` });

    // Press on an unselected box and drag it: no scrolling mid-drag, so it moves by exactly the drag.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    const before = await rect();
    const cx = before.x + 6, cy = before.y + 2;
    await drag(page, [cx, cy], [cx + 3, cy + 1], { ctrl: true });
    const after = await rect();
    expect([after.x - before.x, after.y - before.y]).toEqual([3, 1]);
    // Then, once released, it's scrolled clear of the sheet again.
    await expect.poll(async () => (await at(page, after.x, after.y + after.h - 1)).y).toBeLessThan((await panel.boundingBox()).y);
  });

  test("collapses to a tab on a wide screen", async ({ page }) => {
    await box(page, [2, 4], [14, 8], "wide");
    await click(page, 8, 6);
    const panel = page.getByRole("complementary", { name: "Properties" });
    if (shots) await page.screenshot({ path: `${shots}/wide-open.png` });
    await panel.locator(".panel-head").click();
    const c = await panel.boundingBox();
    expect(c.height).toBeLessThan(40);
    expect(c.x + c.width).toBeGreaterThan(1180);
    if (shots) await page.screenshot({ path: `${shots}/wide-collapsed.png` });
  });
});

test("Ctrl-drag inside a box draws a selection box; Ctrl-click still selects", async ({ page }) => {
  await box(page, [2, 4], [40, 20], "");
  await box(page, [5, 7], [12, 10], "one");
  await box(page, [16, 7], [23, 10], "two");
  await box(page, [28, 7], [35, 10], "three");
  const ids = async () => {
    const s = await state(page);
    return s.selection.map((id) => s.diagram.nodes[id].text).sort();
  };
  // A plain drag from inside the outer box would move it; with Ctrl it selects what it covers.
  const s = await at(page, 4, 6), e = await at(page, 25, 12);
  await page.keyboard.down("Control");
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  expect(await ids()).toEqual(["one", "two"]);
  expect((await state(page)).diagram.nodes[Object.keys((await state(page)).diagram.nodes)[0]].rect.x).toBe(2); // nothing moved

  // Ctrl-click without dragging: selects what's clicked.
  const c = await at(page, 30, 8);
  await page.keyboard.down("Control");
  await page.mouse.click(c.x, c.y);
  await page.keyboard.up("Control");
  expect(await ids()).toEqual(["three"]);
});

test("export the selection only, and as SVG and PNG", async ({ page }) => {
  await box(page, [2, 4], [10, 7], "keep");
  await box(page, [20, 4], [28, 7], "drop");
  await click(page, 5, 5);
  await page.getByTestId("export").click();
  const preview = page.getByTestId("export-text");
  await expect(preview).toContainText("keep");
  await expect(preview).not.toContainText("drop");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/export-dialog.png` });
  await page.getByLabel("Selection only").uncheck();
  await expect(preview).toContainText("drop");
  await page.getByLabel("Selection only").check();

  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "download .svg" }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toMatch(/-selection\.svg$/);
  const svgText = readFileSync(await svg.path(), "utf8");
  expect(svgText).toMatch(/^<svg /);
  expect(svgText).toContain(">keep</text>");
  expect(svgText).not.toContain("drop");
  expect(svgText).toContain("base64,"); // font embedded
  if (process.env.SHOTS) await svg.saveAs(`${process.env.SHOTS}/export.svg`);

  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "download .png" }).click();
  const pngFile = await pngDownload;
  if (process.env.SHOTS) await pngFile.saveAs(`${process.env.SHOTS}/export.png`);
  const png = readFileSync(await pngFile.path());
  expect([...png.subarray(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
  // 2× the picture: 9 columns + padding at 2 × cell width.
  const width = png.readUInt32BE(16);
  const m = await page.evaluate(() => window.__asciigraph__.metrics());
  expect(width).toBe(Math.ceil(11 * m.cw * 2));
});

test("F2 edits the selected box; lists can be turned off, or escaped per line", async ({ page }) => {
  await box(page, [2, 2], [22, 6], "");
  await click(page, 10, 4);
  await page.keyboard.press("F2");
  expect((await state(page)).editing).toMatchObject({ field: "text" });
  await page.keyboard.type("- one\n\\- two");
  await page.keyboard.press("Escape");
  expect(await text(page)).toContain("• one");
  expect(await text(page)).toContain("- two");
  expect(await text(page)).not.toContain("\\");

  // "lists: off": all the text as typed.
  await click(page, 10, 4);
  await page.getByRole("button", { name: "off (text as typed)" }).click();
  expect(await text(page)).toContain("- one");
  expect(await text(page)).toContain("\\- two");
  // Text alignment says "center".
  await expect(page.getByRole("button", { name: "center", exact: true })).toBeVisible();
});
