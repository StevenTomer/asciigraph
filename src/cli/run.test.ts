import { describe, expect, it } from "vitest";
import { encodeShare } from "../storage/share";
import { type CliIO, cliRun, toDiagram } from "./run";

/** Run the command line against in-memory files ("-" / null is standard input). */
function run(args: string[], files: Record<string, string> = {}) {
  const written: Record<string, string> = {};
  const io: CliIO = {
    read: (f) => {
      const key = f ?? "-";
      if (!(key in files)) throw new Error("no such file");
      return files[key];
    },
    write: (f, text) => {
      written[f] = text;
    },
  };
  return { ...cliRun(args, io), written };
}

const SEQ = "sequenceDiagram\n  Client->>API: GET /users\n  API-->>Client: 200 OK";

describe("asciigraph render", () => {
  it("draws Mermaid from standard input", () => {
    const r = run([], { "-": SEQ });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(
      [
        "┌────────┐        ┌────────┐",
        "│ Client │        │  API   │",
        "└───┬────┘        └───┬────┘",
        "    ┆                 ┆",
        "    ┆                 ┆",
        "    ├── GET /users ──►┆",
        "    ┆                 ┆",
        "    ┆◄┄┄┄ 200 OK ┄┄┄┄┄┤",
        "    ┆                 ┆",
        "    ┆                 ┆",
      ].join("\n")
    );
  });

  it("takes a file, a layout direction, ASCII only, and a comment wrap", () => {
    const r = run(["render", "g.mmd", "--lr", "--ascii", "--wrap", "python"], { "g.mmd": "A[One] --> B[Two]" });
    expect(r.stdout).toBe(
      [
        "# +-----+          +-----+",
        "# | One +--------->| Two |",
        "# +-----+          +-----+",
      ].join("\n")
    );
  });

  it("draws folder trees as text or as boxes", () => {
    const tree = "src/\n  main.ts\n  ui/\nREADME.md";
    expect(run([], { "-": tree }).stdout).toBe("src/\n├── main.ts\n└── ui/\nREADME.md");
    expect(run(["--boxes"], { "-": "src/\n  main.ts" }).stdout).toContain("│ main.ts │");
  });

  it("draws a diagram saved from the app, and a share link", () => {
    const { diagram } = toDiagram("A[One] --> B[Two]", { kind: "auto", boxes: false });
    const expected = run([], { "-": "A[One] --> B[Two]" }).stdout;
    expect(run(["d.json"], { "d.json": JSON.stringify({ name: "x", diagram }) }).stdout).toBe(expected);
    expect(run(["d.json"], { "d.json": JSON.stringify(diagram) }).stdout).toBe(expected);
    const link = `https://example.com/graph/#/share/${encodeShare(diagram, "x")}`;
    expect(run([], { "-": link }).stdout).toBe(expected);
  });

  it("writes to a file with -o", () => {
    const r = run(["-o", "out.txt"], { "-": "A --> B" });
    expect(r.stdout).toBe("");
    expect(r.written["out.txt"]).toMatch(/│ A │[\s\S]*│ B │\n└───┘\n$/);
  });

  it("reports warnings on stderr, and problems with an exit code", () => {
    const r = run([], { "-": "A -> B -> " });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("warning: line 1: an arrow with nothing after it");
    expect(run(["--bogus"]).code).toBe(2);
    expect(run(["--kind", "pie"]).stderr).toMatch(/unknown kind "pie"/);
    expect(run(["missing.mmd"]).code).toBe(1);
    expect(run([], { "-": "   " })).toMatchObject({ code: 1, stderr: "asciigraph: nothing to draw" });
    expect(run(["--help"]).stdout).toMatch(/^asciigraph: draw diagrams as text/);
  });
});

describe("asciigraph mermaid", () => {
  it("gives back the text a diagram was drawn from", () => {
    const { diagram } = toDiagram(SEQ, { kind: "auto", boxes: false });
    expect(run(["mermaid", "d.json"], { "d.json": JSON.stringify(diagram) }).stdout).toBe(SEQ);
  });

  it("writes Mermaid for a hand-drawn diagram", () => {
    const { diagram } = toDiagram("A[One] --> B[Two]", { kind: "auto", boxes: false });
    // Forget the text, as if it had been drawn by hand.
    const plain = {
      ...diagram,
      sources: undefined,
      nodes: Object.fromEntries(Object.entries(diagram.nodes).map(([k, n]) => [k, { ...n, gen: undefined }])),
      edges: Object.fromEntries(Object.entries(diagram.edges).map(([k, e]) => [k, { ...e, gen: undefined }])),
    };
    const r = run(["mermaid", "d.json"], { "d.json": JSON.stringify(plain) });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^flowchart TD\n[\s\S]*One[\s\S]*-->[\s\S]*Two/);
  });

  it("needs a saved diagram", () => {
    expect(run(["mermaid"], { "-": "A --> B" })).toMatchObject({ code: 1 });
  });
});

describe("asciigraph markdown", () => {
  const doc = ["# Title", "", "```mermaid", "A[One] --> B[Two]", "```", "", "More text."].join("\n");

  it("adds a drawing after each mermaid block, and updates it when run again", () => {
    const once = run(["markdown", "doc.md"], { "doc.md": doc }).stdout;
    expect(once).toBe(
      [
        "# Title",
        "",
        "```mermaid",
        "A[One] --> B[Two]",
        "```",
        "",
        "<!-- asciigraph: drawn from the mermaid block above; edit that, then run asciigraph markdown -->",
        "```text",
        "┌─────┐",
        "│ One │",
        "└──┬──┘",
        "   │",
        "   │",
        "   │",
        "   ▼",
        "┌─────┐",
        "│ Two │",
        "└─────┘",
        "```",
        "<!-- /asciigraph -->",
        "",
        "More text.",
      ].join("\n")
    );
    expect(run(["markdown", "doc.md"], { "doc.md": once }).stdout).toBe(once);
    const edited = once.replace("A[One] --> B[Two]", "A[One] --> B[Three]");
    const again = run(["markdown", "doc.md"], { "doc.md": edited }).stdout;
    expect(again).toContain("│ Three │");
    expect(again).not.toContain("│ Two │");
    expect(again.match(/<!-- asciigraph:/g)).toHaveLength(1);
  });

  it("updates the file in place with --write", () => {
    const r = run(["markdown", "doc.md", "--write"], { "doc.md": doc });
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("asciigraph: drew 1 block in doc.md");
    expect(r.written["doc.md"]).toContain("│ One │");
    expect(run(["markdown", "--write"], { "-": doc }).code).toBe(2);
  });

  it("leaves other code blocks alone", () => {
    const other = "```js\nconst a = 1;\n```";
    expect(run(["markdown", "doc.md"], { "doc.md": other }).stdout).toBe(other);
  });
});

describe("asciigraph import", () => {
  const drawing = "┌───┐     ┌───┐\n│ A ├────►│ B │\n└───┘     └───┘";

  it("reads a drawing into a diagram for the app", () => {
    const r = run(["import", "old.txt"], { "old.txt": drawing });
    expect(r.code).toBe(0);
    const saved = JSON.parse(r.stdout);
    expect(saved.name).toBe("old");
    expect(Object.values(saved.diagram.nodes).map((n) => (n as { text: string }).text).sort()).toEqual(["A", "B"]);
    expect(Object.keys(saved.diagram.edges)).toHaveLength(1);
  });

  it("draws a drawing again, and writes Mermaid for one", () => {
    expect(run([], { "-": drawing }).stdout).toBe(drawing);
    expect(run(["mermaid"], { "-": drawing }).stdout).toBe("flowchart LR\n  A[A]\n  B[B]\n  A --> B");
  });
});
