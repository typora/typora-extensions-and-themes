const NOTE = /\.(?:md|markdown)$/i;
const EXTENSION = /\.[^/]+$/;
const normalize = (value) => value.normalize("NFKC").toLowerCase();
const withoutExtension = (value) => value.replace(NOTE, "");
const directory = (path) => path.split("/").slice(0, -1);

function internalPath(path) {
  if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) return undefined;
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { decoded = path; }
  return decoded.replaceAll("\\", "/");
}

function collapse(parts) {
  const clean = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!clean.length) return undefined;
      clean.pop();
    } else clean.push(part);
  }
  return clean.join("/");
}

function compareDistance(from, first, second) {
  const origin = directory(from);
  const distance = (path) => {
    const candidate = directory(path);
    let common = 0;
    while (common < origin.length && origin[common] === candidate[common]) common++;
    return origin.length + candidate.length - common * 2;
  };
  return distance(first.path) - distance(second.path) || first.path.localeCompare(second.path, "zh-CN");
}

function pathSimilarity(wanted, candidate) {
  const dirs = directory(candidate.path).map(normalize);
  let suffix = 0;
  while (suffix < wanted.length && suffix < dirs.length && wanted[wanted.length - 1 - suffix] === dirs[dirs.length - 1 - suffix]) suffix++;
  return [suffix, wanted.filter((part) => dirs.includes(part)).length];
}

function fuzzyMarkdown(from, target, byName) {
  const segments = target.split("/").filter((part) => part && part !== "." && part !== "..");
  if (!segments.length) return undefined;
  const candidates = byName.get(normalize(withoutExtension(segments.at(-1)))) ?? [];
  const wanted = segments.slice(0, -1).map(normalize);
  const score = new Map(candidates.map((candidate) => [candidate, pathSimilarity(wanted, candidate)]));
  return [...candidates].sort((a, b) => {
    const [sa, ca] = score.get(a);
    const [sb, cb] = score.get(b);
    return sb - sa || cb - ca || compareDistance(from, a, b);
  })[0];
}

function findNote(from, destination, wiki, byPath, byName) {
  if (!destination) return byPath.get(normalize(withoutExtension(from)));
  const target = internalPath(destination);
  if (target === undefined) return undefined;
  if (!wiki && !NOTE.test(target) && EXTENSION.test(target)) return undefined;
  const relative = collapse([...directory(from), ...target.split("/")]);
  const rooted = collapse(target.split("/"));
  const key = target.startsWith("/") ? rooted : relative;
  const exact = key && byPath.get(normalize(withoutExtension(key)));
  if (exact) return exact;
  if (!wiki) return fuzzyMarkdown(from, target, byName);
  const absolute = rooted && byPath.get(normalize(withoutExtension(rooted)));
  if (absolute) return absolute;
  if (target.includes("/")) return undefined;
  const candidates = byName.get(normalize(withoutExtension(target))) ?? [];
  return [...candidates].sort((a, b) => compareDistance(from, a, b))[0];
}

function parentValues(note) {
  const properties = note.properties;
  const result = [];
  for (const key of ["parent", "up"]) {
    const values = Object.hasOwn(properties, key) ? properties[key] : undefined;
    for (const value of Array.isArray(values) ? values.flat(2) : [values]) {
      if (typeof value !== "string") continue;
      result.push(value.trim().replace(/^\[\[|\]\]$/g, "").split(/[|#]/, 1)[0]);
    }
  }
  return result.filter(Boolean);
}

const noteInfo = ({ path, name }) => ({ path, name });

export function createRelations(notes) {
  const byPath = new Map();
  const byName = new Map();
  const incoming = new Map();
  const outgoing = new Map();
  const parent = new Map();
  const children = new Map();
  for (const note of notes) {
    byPath.set(normalize(withoutExtension(note.path)), note);
    const name = normalize(note.name);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(note);
  }
  for (const note of notes) {
    const resolved = [];
    for (const link of note.links) {
      const { target, wiki, heading, label, line, context } = link;
      if (target && (internalPath(target) === undefined || (!wiki && !NOTE.test(target) && EXTENSION.test(target)))) continue;
      const found = findNote(note.path, target, wiki, byPath, byName);
      resolved.push({ path: found?.path, name: label || target || note.name, heading, broken: !found });
      if (found && found.path !== note.path) {
        if (!incoming.has(found.path)) incoming.set(found.path, []);
        incoming.get(found.path).push({ ...noteInfo(note), line, context: context || label, heading });
      }
    }
    outgoing.set(note.path, resolved);
    const ancestors = parentValues(note)
      .map((value) => findNote(note.path, value, true, byPath, byName))
      .filter((value) => value && value.path !== note.path);
    const unique = [...new Map(ancestors.map((value) => [value.path, value])).values()];
    parent.set(note.path, unique);
    for (const item of unique) {
      if (!children.has(item.path)) children.set(item.path, []);
      children.get(item.path).push(note);
    }
  }
  return { notes, byPath, incoming, outgoing, parent, children };
}

function plainMention(note, name) {
  const target = normalize(name);
  for (const raw of note.body.split("\n")) {
    let text = raw;
    for (const { context, source } of note.links) {
      if (source && context === raw) text = text.replace(source, " ".repeat(source.length));
    }
    if (normalize(text).includes(target)) return raw.trim();
  }
  return undefined;
}

export function noteRelations(graph, path) {
  const note = graph.byPath.get(normalize(withoutExtension(path)));
  if (!note) return undefined;
  const incoming = graph.incoming.get(note.path) ?? [];
  const linked = new Set(incoming.map((item) => item.path));
  const mentions = [];
  for (const candidate of graph.notes) {
    if (candidate.path === note.path || linked.has(candidate.path)) continue;
    const context = plainMention(candidate, note.name);
    if (context) mentions.push({ ...noteInfo(candidate), context });
  }
  const directParents = graph.parent.get(note.path) ?? [];
  const pathUp = [];
  const visited = new Set([note.path]);
  let cursor = note;
  for (;;) {
    const next = graph.parent.get(cursor.path)?.find((item) => !visited.has(item.path));
    if (!next) break;
    visited.add(next.path);
    pathUp.unshift(noteInfo(next));
    cursor = next;
  }
  const siblings = directParents.flatMap((item) => graph.children.get(item.path) ?? []).filter((item) => item.path !== note.path);
  return {
    current: noteInfo(note),
    incoming,
    mentions,
    outgoing: graph.outgoing.get(note.path) ?? [],
    parents: directParents.map(noteInfo),
    ancestry: pathUp,
    siblings: Array.from(new Map(siblings.map((item) => [item.path, noteInfo(item)])).values()),
    children: (graph.children.get(note.path) ?? []).map(noteInfo),
  };
}
