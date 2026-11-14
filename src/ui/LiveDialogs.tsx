import { useEffect, useRef, useState } from "react";
import { givePassword, joinLive, liveLink, myName, ownerAction, setMyName, shareLive } from "../collab/live";
import { ago } from "../collab/history";
import type { Role } from "../collab/protocol";
import { notify } from "../editor/file";
import { type LiveState, useEditor } from "../editor/store";
import { saveCopy } from "../editor/session";
import { Dialog } from "./Dialogs";

/** Your name for live diagrams: asked before joining or sharing one, or to change it. */
export function LiveNameDialog() {
  const ask = useEditor((s) => s.liveAsk);
  if (ask && "password" in ask) return <PasswordDialog ask={ask.password} />;
  return <NameDialog ask={ask} />;
}

function NameDialog({ ask }: { ask: Exclude<ReturnType<typeof useEditor.getState>["liveAsk"], { password: unknown }> }) {
  const [name, setName] = useState(myName());
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(myName()), [ask]);
  if (!ask) return null;

  const close = () => {
    useEditor.setState({ liveAsk: null });
    // Not joining after all: back to your own diagrams.
    if ("join" in ask) location.hash = "#/";
  };
  const go = async () => {
    const n = name.trim();
    if (!n) return;
    setMyName(n);
    if ("join" in ask) {
      useEditor.setState({ liveAsk: null });
      joinLive(ask.join.id, ask.join.key);
    } else if ("share" in ask) {
      setBusy(true);
      try {
        await shareLive();
        useEditor.setState({ liveAsk: null });
        notify("Live: copy the link (bottom left) and send it to the people you want to edit with.");
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    } else {
      useEditor.setState({ liveAsk: null });
    }
  };

  const title = "join" in ask ? "join a live diagram" : "share" in ask ? "share live" : "your name";
  return (
    <Dialog title={title} onClose={close}>
      {"share" in ask && (
        <p>
          This puts a copy of this diagram on the server, where anyone you send its link to can edit it with you at the
          same time. Your own copy stays as it is.
        </p>
      )}
      <div className="row">
        <span className="row-label">your name</span>
        <input
          className="field grow"
          value={name}
          autoFocus
          maxLength={60}
          aria-label="Your name"
          placeholder="as the others will see it"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void go()}
        />
      </div>
      <p className="note muted">Shown to the others editing the diagram, so they can tell who's who.</p>
      <div className="row buttons">
        <button className="tb accent" disabled={!name.trim() || busy} onClick={() => void go()}>
          {"join" in ask ? "join" : "share" in ask ? "share it" : "ok"}
        </button>
        <button className="tb" onClick={close}>cancel</button>
      </div>
    </Dialog>
  );
}

/** A live diagram's password: asked for when it has one (and again if it was wrong). */
function PasswordDialog({ ask }: { ask: { id: string; key: string; wrong: boolean } }) {
  const [pw, setPw] = useState("");
  const close = () => {
    useEditor.setState({ liveAsk: null });
    location.hash = "#/";
  };
  const go = () => {
    if (!pw) return;
    useEditor.setState({ liveAsk: null });
    givePassword(ask.id, ask.key, pw);
  };
  return (
    <Dialog title="password" onClose={close}>
      <p>{ask.wrong ? "That password isn't right. Try again:" : "This live diagram needs a password. Ask its owner for it."}</p>
      <div className="row">
        <span className="row-label">password</span>
        <input
          className="field grow"
          type="password"
          value={pw}
          autoFocus
          aria-label="Password"
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
      </div>
      <div className="row buttons">
        <button className="tb accent" disabled={!pw} onClick={go}>join</button>
        <button className="tb" onClick={close}>cancel</button>
      </div>
    </Dialog>
  );
}

const STATUS: Record<LiveState["status"], [string, string]> = {
  connecting: ["connecting…", "Connecting to the server"],
  live: ["live", "Changes are shared as you make them"],
  offline: ["offline", "Lost the connection: reconnecting. Your changes are sent once it's back"],
  denied: ["link refused", "The server refused this link (it may have been replaced)"],
  deleted: ["deleted", "The owner deleted this live diagram (save a copy to keep it)"],
};

const ROLE: Record<Role, string> = { owner: "owner", edit: "can edit", view: "view only" };

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0].toUpperCase()).join("") || "?";

/** Bottom-left, in a live diagram: its connection, who's here (you first), its link, and keeping
 * a copy of your own. */
export function LivePanel() {
  const live = useEditor((s) => s.live);
  if (!live) return null;
  return <LiveBar live={live} />;
}

function LiveBar({ live }: { live: LiveState }) {
  const [label, title] = STATUS[live.status];
  // Where the page can't use the clipboard (plain http at an address other than localhost):
  // the link, selected, to copy by hand.
  const [showLink, setShowLink] = useState(false);
  const [dialog, setDialog] = useState<"owner" | "history" | null>(null);
  const viewing = live.role === "view";
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(live.link);
      notify(viewing ? "Copied the link: anyone with it can see this diagram." : "Copied the link: anyone with it can edit this diagram.");
    } catch {
      setShowLink(true);
    }
  };
  const ended = live.status === "denied" || live.status === "deleted";
  return (
    <>
      <span className="live-bar" role="group" aria-label="Live diagram" data-testid="live">
        <span className={"live-status " + live.status} title={title}>● {label}</span>
        {live.readOnly && !ended && (
          <span className="live-ro" title={viewing ? "You came in with the view link" : "The owner made this diagram read-only"} data-testid="view-only">
            view only
          </span>
        )}
        <button
          className="peer me"
          style={{ borderColor: live.me.color, color: live.me.color }}
          title={`You: ${live.me.name}${live.role ? ` (${ROLE[live.role]})` : ""} (click to change your name)`}
          onClick={() => useEditor.setState({ liveAsk: { rename: true } })}
        >
          {initials(live.me.name)}
        </button>
        {live.peers.map((p) => (
          <span key={p.clientId} className="peer" style={{ background: p.color }} title={p.name + (p.role ? ` (${ROLE[p.role]})` : "")} data-testid="peer">
            {initials(p.name)}
          </span>
        ))}
        {!ended && (
          <button className="tb" onClick={() => void copyLink()} title={viewing ? "Copy the link that lets people see this diagram" : "Copy the link that lets people edit this diagram with you"}>
            copy link
          </button>
        )}
        <button className="tb" onClick={() => setDialog("history")} title="Who changed what">history</button>
        {live.role === "owner" && !ended && (
          <button className="tb" onClick={() => setDialog("owner")} title="Links, a password, read-only, deleting it">owner…</button>
        )}
        <button className="tb" onClick={() => void saveCopy()} title="Keep a copy of your own (not live)">save a copy</button>
      </span>
      {/* Outside the bar: dialogs cover the page. */}
      {showLink && (
        <Dialog title="link" onClose={() => setShowLink(false)}>
          <p>Send this link to the people you want to {viewing ? "show it to" : "edit with"}. Anyone with it can {viewing ? "see" : "edit"} this diagram.</p>
          <input
            className="field grow"
            readOnly
            autoFocus
            value={live.link}
            aria-label="The link to send"
            onFocus={(e) => e.target.select()}
            style={{ width: "100%" }}
          />
          <p className="note muted">Copy it with Ctrl+C (⌘C on a Mac).</p>
        </Dialog>
      )}
      {dialog === "history" && <HistoryDialog live={live} onClose={() => setDialog(null)} />}
      {dialog === "owner" && <OwnerDialog live={live} onClose={() => setDialog(null)} />}
    </>
  );
}

/** A link with a copy button (if copying isn't allowed, the link is selected to copy by hand). */
function LinkRow({ label, link, children }: { label: string; link: string | null; children?: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      notify(`Copied the ${label}.`);
    } catch {
      input.current?.focus();
      input.current?.select();
      notify("Copy it with Ctrl+C (⌘C on a Mac).");
    }
  };
  return (
    <div className="row">
      <span className="row-label">{label.replace(/ link$/, "")}</span>
      <input
        ref={input}
        className="field grow"
        readOnly
        value={link ?? ""}
        placeholder="replace it to make one"
        aria-label={label}
        onFocus={(e) => e.target.select()}
      />
      <button className="tb" disabled={!link} onClick={() => void copy()}>copy</button>
      {children}
    </div>
  );
}

/** The owner's controls: the links (and replacing them), a password, read-only, who's here,
 * deleting it. */
function OwnerDialog({ live, onClose }: { live: LiveState; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [deleting, setDeleting] = useState(false);
  const keys = live.keys;
  const link = (key: string | null | undefined) => (key ? liveLink(live.id, key) : null);
  const replace = (kind: "edit" | "view") => {
    ownerAction({ action: "replace", value: kind });
    notify(`Made a new ${kind} link: the old one no longer works, and anyone using it has been sent out.`);
  };
  const setPassword = (value: string | null) => {
    ownerAction({ action: "password", value });
    setPw("");
    notify(value ? "Password set: everyone else gives it to come back in." : "Password removed.");
  };
  return (
    <Dialog title="owner" onClose={onClose}>
      <h3>links</h3>
      <LinkRow label="edit link" link={link(keys?.edit)}>
        <button className="tb" onClick={() => replace("edit")} title="Make a new edit link: the old one stops working">replace</button>
      </LinkRow>
      <LinkRow label="view link" link={link(keys?.view)}>
        <button className="tb" onClick={() => replace("view")} title="Make a new view link: the old one stops working">replace</button>
      </LinkRow>
      <LinkRow label="owner link" link={link(keys?.owner)} />
      <p className="note muted">
        The view link lets people watch but not change anything. The owner link opens these controls on another computer
        or browser: keep it to yourself.
      </p>

      <h3>password</h3>
      <div className="row">
        <span className="row-label">{live.settings.password ? "on" : "none"}</span>
        <input
          className="field grow"
          type="password"
          value={pw}
          aria-label="New password"
          placeholder={live.settings.password ? "a new password" : "needed besides the link"}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && pw && setPassword(pw)}
        />
        <button className="tb" disabled={!pw} onClick={() => setPassword(pw)}>set</button>
        {live.settings.password && <button className="tb" onClick={() => setPassword(null)}>remove</button>}
      </div>
      <p className="note muted">Everyone but you gives it, with either link. Setting one sends out everyone else until they do.</p>

      <h3>changes</h3>
      <label className="row">
        <input
          type="checkbox"
          checked={live.settings.readOnly}
          onChange={(e) => ownerAction({ action: "readOnly", value: e.target.checked })}
        />
        read-only: only you can change it
      </label>

      <h3>here now</h3>
      <ul className="people">
        <li>{live.me.name} (you, owner)</li>
        {live.peers.map((p) => (
          <li key={p.clientId}>
            <span className="swatch" style={{ background: p.color }} /> {p.name}
            {p.role && <span className="muted"> · {ROLE[p.role]}</span>}
          </li>
        ))}
      </ul>

      <h3>delete</h3>
      {deleting ? (
        <div className="row">
          <span className="grow">Delete it from the server, for everyone?</span>
          <button className="tb danger" onClick={() => ownerAction({ action: "delete" })}>delete it</button>
          <button className="tb" onClick={() => setDeleting(false)}>cancel</button>
        </div>
      ) : (
        <div className="row">
          <button className="tb danger" onClick={() => setDeleting(true)}>delete live diagram…</button>
          <span className="note muted">You can save a copy first.</span>
        </div>
      )}
    </Dialog>
  );
}

/** Who changed what, newest first. */
function HistoryDialog({ live, onClose }: { live: LiveState; onClose: () => void }) {
  const entries = [...live.history].reverse();
  return (
    <Dialog title="history" onClose={onClose}>
      {entries.length ? (
        <ul className="history" data-testid="history">
          {entries.map((e) => (
            <li key={e.id}>
              <b>{e.name}</b> {e.summary}
              {e.count > 1 && <span className="muted"> (×{e.count})</span>}
              <span className="muted" title={new Date(e.at).toLocaleString()}> · {ago(e.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No changes yet.</p>
      )}
    </Dialog>
  );
}
