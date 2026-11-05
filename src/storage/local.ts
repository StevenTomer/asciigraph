import { isDiagram } from "../model/ops";
import type { Diagram } from "../model/types";
import type { DiagramMeta, DiagramRepository } from "./repository";

/**
 * Diagrams in this browser's localStorage. Every key starts with "asciigraph/": the app may share
 * its origin with other apps. Reads and writes are wrapped because storage can be
 * unavailable (private windows, blocked site data) or full.
 */
const NS = "asciigraph/";
const INDEX = NS + "index";
const docKey = (id: string) => `${NS}diagram/${id}`;

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full: the diagram stays in memory.
  }
}

function readIndex(): DiagramMeta[] {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeIndex(list: DiagramMeta[]) {
  try {
    localStorage.setItem(INDEX, JSON.stringify(list));
  } catch {
    // see writeJson
  }
}

export const localRepository: DiagramRepository = {
  async list() {
    return readIndex().sort((a, b) => b.updated - a.updated);
  },
  async load(id) {
    try {
      const d = JSON.parse(localStorage.getItem(docKey(id)) ?? "null");
      return isDiagram(d) ? d : null;
    } catch {
      return null;
    }
  },
  async save(id, name, diagram: Diagram) {
    try {
      localStorage.setItem(docKey(id), JSON.stringify(diagram));
    } catch {
      return;
    }
    const list = readIndex().filter((m) => m.id !== id);
    writeIndex([...list, { id, name, updated: Date.now() }]);
  },
  async rename(id, name) {
    writeIndex(readIndex().map((m) => (m.id === id ? { ...m, name, updated: Date.now() } : m)));
  },
  async remove(id) {
    try {
      localStorage.removeItem(docKey(id));
    } catch {
      // ignore
    }
    writeIndex(readIndex().filter((m) => m.id !== id));
  },
};
