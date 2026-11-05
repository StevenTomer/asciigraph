import { useEffect, useMemo, useRef, useState } from "react";
import { findMatches } from "../editor/find";
import { closeFind, select, useEditor } from "../editor/store";
import { showSelection } from "../editor/view";

/**
 * Find (Ctrl+F): type to search the text of boxes and connectors. Enter goes to the next match
 * (Shift+Enter the one before), selecting it and scrolling it into view; "all" selects every
 * match. Esc closes it.
 */
export function FindBar() {
  const open = useEditor((s) => s.findOpen);
  return open ? <Body /> : null;
}

function Body() {
  const diagram = useEditor((s) => s.diagram);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(-1);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const matches = useMemo(() => findMatches(diagram, query), [diagram, query]);

  const go = (i: number) => {
    if (!matches.length) return;
    const k = ((i % matches.length) + matches.length) % matches.length;
    setAt(k);
    select([matches[k]]);
    showSelection();
  };
  // Typing shows the first match.
  useEffect(() => {
    setAt(-1);
    if (matches.length) go(0);
  }, [query]);

  return (
    <div className="find" role="search" aria-label="Find">
      <input
        ref={ref}
        className="field"
        value={query}
        placeholder="find text"
        aria-label="Find text"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") closeFind();
          if (e.key === "Enter") go(at + (e.shiftKey ? -1 : 1));
        }}
      />
      <span className="muted" data-testid="find-count">
        {query.trim() ? (matches.length ? `${at + 1} of ${matches.length}` : "no matches") : ""}
      </span>
      <button className="tb" onClick={() => go(at - 1)} disabled={!matches.length} aria-label="Previous match" title="Shift+Enter">↑</button>
      <button className="tb" onClick={() => go(at + 1)} disabled={!matches.length} aria-label="Next match" title="Enter">↓</button>
      <button className="tb" onClick={() => { select(matches); showSelection(); }} disabled={!matches.length} title="Select every match">all</button>
      <button className="tb" onClick={closeFind} aria-label="Close find">✕</button>
    </div>
  );
}
