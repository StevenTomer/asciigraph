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

test("the box tool stays on: draw several boxes in a row", async ({ page }) => {
  await page.keyboard.press("b");
  for (const x of [2, 14, 26]) {
    await drag(page, [x, 2], [x + 8, 4]);
    await page.keyboard.type(`b${x}`);
  }
  await page.keyboard.press("Escape"); // finish typing
  expect((await state(page)).tool).toBe("box");
  expect(Object.keys((await state(page)).diagram.nodes)).toHaveLength(3);
  expect(await text(page)).toContain("b26");
  await page.keyboard.press("Escape"); // back to select
  expect((await state(page)).tool).toBe("select");
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
  await drag(page, [16, 2], [16, 12]);
  expect(await text(page)).toBe(before); // same drawing, just lower (text is trimmed to the drawing)
  let d = (await state(page)).diagram;
  expect(d.nodes[frame.id].rect.y).toBe(12);
  expect(d.nodes[in1.id].rect.y).toBe(14);

  // Alt-drag: only the frame moves.
  await drag(page, [16, 12], [16, 13], { alt: true });
  d = (await state(page)).diagram;
  expect(d.nodes[frame.id].rect.y).toBe(13);
  expect(d.nodes[in1.id].rect.y).toBe(14);

  // "inside: stays put" makes that the box's default.
  await page.keyboard.press("Control+z");
  await click(page, 16, 12);
  await page.getByRole("button", { name: "stays put" }).click();
  await drag(page, [16, 12], [16, 11]);
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
