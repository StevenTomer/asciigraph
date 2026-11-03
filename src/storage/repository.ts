import type { Diagram } from "../model/types";

export interface DiagramMeta {
  id: string;
  name: string;
  /** ms since epoch */
  updated: number;
}

/**
 * Where diagrams are kept. v1 is the browser (local.ts); a server-backed repository can implement
 * the same interface later without the editor changing. Async for that reason.
 */
export interface DiagramRepository {
  list(): Promise<DiagramMeta[]>;
  load(id: string): Promise<Diagram | null>;
  save(id: string, name: string, diagram: Diagram): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}
