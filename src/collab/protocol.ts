import type { HistoryEntry } from "./history";

/**
 * What the live-editing server (server/app.ts) and the app (collab/live.ts) say to each other
 * besides the diagram itself: Hocuspocus stateless messages, as JSON.
 *
 * Who you are in a live diagram comes from the link you opened:
 *  - owner: the owner link (or the owner's secret this browser keeps): can edit, and has the
 *    owner's controls;
 *  - edit: the edit link: can edit (unless the owner made the diagram read-only);
 *  - view: the view link: sees it, changes and all, but can't change it.
 */
export type Role = "owner" | "edit" | "view";

export interface LiveSettings {
  /** Only the owner can change it. */
  readOnly: boolean;
  /** A password is needed besides the link (not for the owner). */
  password: boolean;
}

/** The keys in the links (the owner's only). null: unknown (a diagram shared before there were
 * view links; replace it to get one). */
export interface LiveKeys {
  edit: string | null;
  view: string | null;
}

export type ServerMessage =
  | { type: "hello"; role: Role; settings: LiveSettings; keys?: LiveKeys; history: HistoryEntry[] }
  | { type: "settings"; settings: LiveSettings; keys?: LiveKeys }
  | { type: "history"; entry: HistoryEntry }
  | { type: "error"; message: string };

export type OwnerAction =
  | { action: "password"; value: string | null }
  | { action: "readOnly"; value: boolean }
  | { action: "replace"; value: "edit" | "view" }
  | { action: "delete" };

export type ClientMessage = { type: "owner" } & OwnerAction;

/** Why the server turned you away (authentication) or closed the diagram on you. */
export const DENIED = "denied", PASSWORD = "password", WRONG_PASSWORD = "wrong-password";
export const REPLACED = "replaced", DELETED = "deleted";
/** Too many tries from your address (or wrong passwords): wait a bit. The diagram is full. */
export const TOO_MANY = "too-many", FULL = "full";

/** Who last changed each box and connector (a map in the document, kept by the server). */
export interface Stamp {
  name: string;
  at: number;
}
