import { useEffect, useState } from "react";
import { attachClipboard } from "../editor/clipboard";
import { attachKeyboard } from "../editor/keyboard";
import { openFromHash, startAutosave } from "../editor/session";
import { useEditor } from "../editor/store";
import { Canvas } from "./Canvas";
import { ContextMenu } from "./ContextMenu";
import { DiagramsDialog, ExportDialog, HelpDialog } from "./Dialogs";
import { Inspector } from "./Inspector";
import { TextEditor } from "./TextEditor";
import { TextSourceDialog } from "./TextSourceDialog";
import { ZoomControls } from "./ZoomControls";
import { type DialogId, Toolbar } from "./Toolbar";

export function App() {
  const [dialog, setDialog] = useState<DialogId>(null);
  const dark = useEditor((s) => s.dark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    const cleanups = [attachKeyboard(), attachClipboard(), startAutosave()];
    const onHash = () => void openFromHash();
    window.addEventListener("hashchange", onHash);
    void openFromHash();
    return () => {
      cleanups.forEach((c) => c());
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  const close = () => setDialog(null);
  return (
    <div className="app">
      <Canvas />
      <TextEditor />
      <Toolbar openDialog={setDialog} />
      <Inspector />
      <ZoomControls />
      <ContextMenu />
      <TextSourceDialog />
      {dialog === "export" && <ExportDialog onClose={close} />}
      {dialog === "diagrams" && <DiagramsDialog onClose={close} />}
      {dialog === "help" && <HelpDialog onClose={close} />}
    </div>
  );
}
