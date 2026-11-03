/**
 * Folder trees from text. Accepts:
 *  - `tree` command output:   project/ ├── src/ │   └── main.ts   (also ASCII |-- `-- +--)
 *  - indented lists:          src/ ⏎ ··main.ts   (spaces, tabs, optional "- " / "* " bullets)
 *  - path lists:              src/main.ts ⏎ src/util.ts ⏎ README.md
 * Entries ending in "/" or having children are folders.
 */

export interface TreeEntry {
  name: string;
  dir: boolean;
  /** Path from the top, joined with "/": a stable identity for redrawing. */
  path: string;
  children: TreeEntry[];
}

export interface ParsedTree {
  roots: TreeEntry[];
  warnings: string[];
}

const BRANCH = /^((?:[│|]   |    |[├└|`+][─-]{2} )*)(.*)$/;

export function parseTree(text: string): ParsedTree {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
  if (!lines.length) return { roots: [], warnings: [] };
  const isTreeOutput = lines.some((l) => /[├└]──|^\s*[|`+]--/.test(l) || /[│|]   [├└|`+]/.test(l));
  const isPathList = !isTreeOutput && lines.every((l) => !/^\s/.test(l)) && lines.some((l) => /[^/]\/[^/]/.test(l));

  const items: { depth: number; name: string }[] = [];
  if (isTreeOutput) {
    for (const l of lines) {
      // Skip tree's summary line ("3 directories, 5 files").
      if (/^\d+ director(y|ies)(, \d+ files?)?$/.test(l.trim())) continue;
      const m = BRANCH.exec(l)!;
      items.push({ depth: m[1].length / 4, name: m[2].trim() });
    }
  } else if (isPathList) {
    return { roots: fromPaths(lines.map((l) => l.trim())), warnings: [] };
  } else {
    const indents = lines.map((l) => l.replace(/\t/g, "  ").match(/^ */)![0].length);
    const unit = Math.min(...indents.filter((n) => n > 0), Infinity);
    lines.forEach((l, i) => {
      const name = l.trim().replace(/^[-*+]\s+/, "");
      items.push({ depth: unit === Infinity ? 0 : Math.round(indents[i] / unit), name });
    });
  }
  return { roots: fromDepths(items), warnings: [] };
}

function entry(name: string, parentPath: string): TreeEntry {
  const dir = name.endsWith("/");
  const clean = dir ? name.replace(/\/+$/, "") : name;
  return { name: clean, dir, path: parentPath ? `${parentPath}/${clean}` : clean, children: [] };
}

function fromDepths(items: { depth: number; name: string }[]): TreeEntry[] {
  const roots: TreeEntry[] = [];
  const stack: TreeEntry[] = [];
  for (const { depth, name } of items) {
    // A jump of more than one level hangs off the deepest entry so far.
    const level = Math.min(depth, stack.length);
    stack.length = level;
    const parent = stack[level - 1];
    const e = entry(name, parent?.path ?? "");
    if (parent) {
      parent.children.push(e);
      parent.dir = true;
    } else {
      roots.push(e);
    }
    stack.push(e);
  }
  return roots;
}

function fromPaths(paths: string[]): TreeEntry[] {
  const roots: TreeEntry[] = [];
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    let level = roots, parentPath = "";
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      let e = level.find((x) => x.name === part);
      if (!e) {
        e = entry(part + (!last || p.endsWith("/") ? "/" : ""), parentPath);
        level.push(e);
      }
      if (!last) e.dir = true;
      parentPath = e.path;
      level = e.children;
    });
  }
  return roots;
}

/** The classic `tree` drawing of entries; folders get a trailing "/". */
export function treeText(roots: TreeEntry[]): string {
  const out: string[] = [];
  const walk = (e: TreeEntry, prefix: string, last: boolean, top: boolean) => {
    const name = e.name + (e.dir && e.name !== "." ? "/" : "");
    out.push(top ? name : `${prefix}${last ? "└── " : "├── "}${name}`);
    const next = top ? "" : prefix + (last ? "    " : "│   ");
    e.children.forEach((c, i) => walk(c, next, i === e.children.length - 1, false));
  };
  roots.forEach((r) => walk(r, "", true, true));
  return out.join("\n");
}
