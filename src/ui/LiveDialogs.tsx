import { useEffect, useState } from "react";
import { joinLive, myName, setMyName, shareLive } from "../collab/live";
import { notify } from "../editor/file";
import { type LiveState, useEditor } from "../editor/store";
import { saveCopy } from "../editor/session";
import { Dialog } from "./Dialogs";

/** Your name for live diagrams: asked before joining or sharing one, or to change it. */
export function LiveNameDialog() {
  const ask = useEditor((s) => s.liveAsk);
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
        notify("Live: copy the link (in the toolbar) and send it to the people you want to edit with.");
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

const STATUS: Record<LiveState["status"], [string, string]> = {
  connecting: ["connecting…", "Connecting to the server"],
  live: ["live", "Changes are shared as you make them"],
  offline: ["offline", "Lost the connection: reconnecting. Your changes are sent once it's back"],
  denied: ["link refused", "The server refused this link (it may have been replaced)"],
};

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
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(live.link);
      notify("Copied the link: anyone with it can edit this diagram.");
    } catch {
      notify(live.link);
    }
  };
  return (
    <span className="live-bar" role="group" aria-label="Live diagram" data-testid="live">
      <span className={"live-status " + live.status} title={title}>● {label}</span>
      <button
        className="peer me"
        style={{ borderColor: live.me.color, color: live.me.color }}
        title={`You: ${live.me.name} (click to change your name)`}
        onClick={() => useEditor.setState({ liveAsk: { rename: true } })}
      >
        {initials(live.me.name)}
      </button>
      {live.peers.map((p) => (
        <span key={p.clientId} className="peer" style={{ background: p.color }} title={p.name} data-testid="peer">
          {initials(p.name)}
        </span>
      ))}
      <button className="tb" onClick={() => void copyLink()} title="Copy the link that lets people edit this diagram with you">copy link</button>
      <button className="tb" onClick={() => void saveCopy()} title="Keep a copy of your own (not live)">save a copy</button>
    </span>
  );
}
