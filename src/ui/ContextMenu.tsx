import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type MenuEntry, type MenuItem, contextMenu } from "../editor/commands";
import { setMenu, useEditor } from "../editor/store";

/** The right-click menu. Entries come from editor/commands.ts for the current selection. */
export function ContextMenu() {
  const menu = useEditor((s) => s.menu);
  const entries = useMemo(() => (menu ? contextMenu(menu.cell) : []), [menu]);
  const close = () => setMenu(null);

  useEffect(() => {
    if (!menu) return;
    // A click outside just closes the menu (it doesn't also start drawing on the canvas).
    const outside = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest(".menu")) return;
      close();
      if ((e.target as HTMLElement).id === "canvas") e.stopPropagation();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("wheel", close);
    };
  }, [menu]);

  if (!menu) return null;
  return <Menu entries={entries} x={menu.x} y={menu.y} onDone={close} autoFocus />;
}

function Menu(props: { entries: MenuEntry[]; x: number; y: number; onDone: () => void; autoFocus?: boolean; onBack?: () => void; flipX?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: props.x, y: props.y });
  const [open, setOpen] = useState<number | null>(null);
  const [subAt, setSubAt] = useState<{ x: number; y: number; flipX: number }>({ x: 0, y: 0, flipX: 0 });

  // Keep the menu on screen: flip left/up when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    let x = props.x, y = props.y;
    if (x + r.width > window.innerWidth - 4) x = Math.max(4, (props.flipX ?? props.x) - r.width);
    if (y + r.height > window.innerHeight - 4) y = Math.max(4, window.innerHeight - 4 - r.height);
    setPos({ x, y });
    // Focus the menu itself (not an item, which would look pre-selected); arrows then move in.
    if (props.autoFocus) el.focus();
  }, [props.x, props.y]);

  const buttons = () => [...ref.current!.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)")];
  const openSub = (i: number, button: HTMLElement, focus = false) => {
    const r = button.getBoundingClientRect();
    setSubAt({ x: r.right - 2, y: r.top - 4, flipX: r.left + 2 });
    setOpen(i);
    if (focus) setTimeout(() => ref.current?.querySelector<HTMLButtonElement>(".menu .menu button:not(:disabled)")?.focus());
  };

  const keyDown = (e: React.KeyboardEvent, i: number, item: MenuItem) => {
    const list = buttons();
    const at = list.indexOf(e.currentTarget as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      list[(at + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (e.key === "ArrowRight" && item.submenu) {
      e.preventDefault();
      e.stopPropagation();
      openSub(i, e.currentTarget as HTMLElement, true);
    } else if (e.key === "ArrowLeft" && props.onBack) {
      e.preventDefault();
      e.stopPropagation();
      props.onBack();
    }
  };

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.target !== ref.current || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
        e.preventDefault();
        const list = buttons();
        list[e.key === "ArrowDown" ? 0 : list.length - 1]?.focus();
      }}
    >
      {props.entries.map((entry, i) =>
        entry === "separator" ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={"menu-item" + (open === i ? " open" : "")}
            disabled={entry.disabled}
            aria-haspopup={entry.submenu ? "menu" : undefined}
            aria-expanded={entry.submenu ? open === i : undefined}
            aria-keyshortcuts={entry.shortcut?.replace(/^⌘/, "Meta+").replace("⇧", "Shift+")}
            onPointerEnter={(e) => (entry.submenu ? openSub(i, e.currentTarget) : setOpen(null))}
            onKeyDown={(e) => keyDown(e, i, entry)}
            onClick={(e) => {
              if (entry.submenu) return openSub(i, e.currentTarget, true);
              props.onDone();
              entry.run?.();
            }}
          >
            <span className="menu-label">{entry.label}</span>
            {entry.hint && <span className="menu-hint">{entry.hint}</span>}
            <span className="menu-shortcut" aria-hidden>{entry.submenu ? "▸" : entry.shortcut}</span>
          </button>
        )
      )}
      {open !== null && typeof props.entries[open] === "object" && (props.entries[open] as MenuItem).submenu && (
        <Menu
          entries={(props.entries[open] as MenuItem).submenu!}
          x={subAt.x}
          y={subAt.y}
          flipX={subAt.flipX}
          onDone={props.onDone}
          onBack={() => {
            ref.current?.querySelector<HTMLButtonElement>(":scope > .menu-item.open")?.focus();
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}
