import { buildGraph, layoutGraph, localGraph, MAX_GLOBAL_NODES } from "./graph.js";
import { noteCards } from "./review.js";

const SKIPPED = new Set(["tags", "parent", "up"]);
const MAX_PROPS = 6;
const MAX_VALUE = 60;

export function noteInfo(note) {
  const open = note.tasks.filter(({ completed }) => !completed);
  const dates = open.map(({ due }) => due).filter(Boolean).sort();
  const props = [];
  for (const [key, value] of Object.entries(note.properties)) {
    if (SKIPPED.has(key) || value === null || typeof value === "object") continue;
    const text = String(value);
    props.push([key, text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text]);
    if (props.length === MAX_PROPS) break;
  }
  return { open: open.length, done: note.tasks.length - open.length, due: dates[0] ?? null, cards: noteCards(note).length, tags: note.tags.slice(0, 8), props };
}

const SIZE = { width: 1000, height: 700 };
const LOCAL_SIZE = { width: 600, height: 420 };

export function createGraphModel() {
  let signature;
  let previousRelations;
  let base;
  let global;
  let version = 0;
  let info;
  const locals = new Map();
  return (relations, path) => {
    if (relations !== previousRelations) {
      const graph = buildGraph(relations);
      const next = JSON.stringify([graph.nodes, graph.edges]);
      if (next !== signature) {
        signature = next;
        base = graph;
        global = relations.notes.length > MAX_GLOBAL_NODES ? undefined : layoutGraph(graph, SIZE);
        version++;
        locals.clear();
      }
      info = Object.fromEntries(relations.notes.map((note) => [note.path, noteInfo(note)]));
      previousRelations = relations;
    }
    const key = path ?? "";
    if (!locals.has(key)) {
      locals.set(key, [1, 2, 3].map((depth) => layoutGraph(localGraph(base, key, depth), LOCAL_SIZE)));
      if (locals.size > 16) locals.delete(locals.keys().next().value);
    }
    return { current: path, overflow: !global, global, info, version, local: locals.get(key), size: SIZE, localSize: LOCAL_SIZE };
  };
}
