export const MAX_GLOBAL_NODES = 2000;

export function buildGraph(relations) {
  const nodes = new Map();
  const edges = new Map();
  for (const note of relations.notes) {
    const folder = note.path.includes("/") ? note.path.split("/")[0] : "";
    nodes.set(note.path, { id: note.path, name: note.name, path: note.path, group: folder });
  }
  for (const note of relations.notes) {
    for (const link of relations.outgoing.get(note.path) ?? []) {
      if (link.path === note.path) continue;
      const target = link.broken ? `broken:${link.name}` : link.path;
      if (link.broken && !nodes.has(target)) nodes.set(target, { id: target, name: link.name, broken: true });
      const pair = JSON.stringify([note.path, target].sort());
      if (!edges.has(pair)) edges.set(pair, { source: note.path, target, kind: "link" });
    }
    for (const parent of relations.parent.get(note.path) ?? []) {
      edges.set(`parent\n${note.path}\n${parent.path}`, { source: note.path, target: parent.path, kind: "parent" });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function localGraph(graph, path, depth) {
  if (!graph.nodes.some(({ id }) => id === path)) return { nodes: [], edges: [] };
  const neighbours = new Map();
  for (const { source, target } of graph.edges) {
    if (!neighbours.has(source)) neighbours.set(source, []);
    if (!neighbours.has(target)) neighbours.set(target, []);
    neighbours.get(source).push(target);
    neighbours.get(target).push(source);
  }
  const seen = new Set([path]);
  let frontier = [path];
  for (let step = 0; step < depth; step++) {
    const next = [];
    for (const id of frontier) {
      for (const other of neighbours.get(id) ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return {
    nodes: graph.nodes.filter(({ id }) => seen.has(id)),
    edges: graph.edges.filter(({ source, target }) => seen.has(source) && seen.has(target)),
  };
}

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.codePointAt(0), 16777619) >>> 0;
  return value / 4294967296;
}

const GAP = 14;
const MARGIN_Y = 24;
const MAX_STRETCH = 2;
const GROUP_MIN_NODES = 30;
const GROUP_PULL = 0.012;

// Folders get anchor points on an ellipse, bigger folders first, so notes of one folder settle
// near each other even when most of their links cross folders.
function groupAnchors(nodes, width, height) {
  const sizes = new Map();
  for (const { group, broken } of nodes) if (!broken) sizes.set(group, (sizes.get(group) ?? 0) + 1);
  const groups = [...sizes].filter(([, size]) => size >= 3).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  if (groups.length < 2) return undefined;
  const anchors = new Map();
  groups.forEach(([name], position) => {
    const angle = (position / groups.length) * Math.PI * 2 - Math.PI / 2;
    anchors.set(name, { x: width / 2 + Math.cos(angle) * width * 0.34, y: height / 2 + Math.sin(angle) * height * 0.34 });
  });
  return anchors;
}

function marginX(width) {
  return Math.min(90, width / 4);
}

function forceLayout(graph, width, height) {
  const count = graph.nodes.length;
  if (count === 1) return [{ x: width / 2, y: height / 2 }];
  const index = new Map(graph.nodes.map(({ id }, position) => [id, position]));
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const anchors = count >= GROUP_MIN_NODES ? groupAnchors(graph.nodes, width, height) : undefined;
  const anchorOf = graph.nodes.map(({ group, broken }) => (broken ? undefined : anchors?.get(group)));
  graph.nodes.forEach(({ id }, position) => {
    const angle = hash(`a${id}`) * Math.PI * 2;
    const radius = (0.15 + hash(`r${id}`) * 0.35) * Math.min(width, height);
    const anchor = anchorOf[position];
    const spread = anchor ? 0.35 : 1;
    px[position] = (anchor?.x ?? width / 2) + Math.cos(angle) * radius * spread;
    py[position] = (anchor?.y ?? height / 2) + Math.sin(angle) * radius * spread;
  });
  const links = graph.edges.map(({ source, target }) => [index.get(source), index.get(target)]);
  const idealSquared = (width * height) / count;
  const ideal = Math.sqrt(idealSquared);
  const cell = ideal * 2;
  const rounds = count > 800 ? 80 : 200;
  const fx = new Float64Array(count);
  const fy = new Float64Array(count);
  for (let round = 0; round < rounds; round++) {
    const cooling = 1 - round / rounds;
    fx.fill(0);
    fy.fill(0);
    const grid = new Map();
    for (let i = 0; i < count; i++) {
      const key = `${Math.floor(px[i] / cell)},${Math.floor(py[i] / cell)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
    for (let i = 0; i < count; i++) {
      const cx = Math.floor(px[i] / cell);
      const cy = Math.floor(py[i] / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const j of grid.get(`${gx},${gy}`) ?? []) {
            if (j <= i) continue;
            let dx = px[i] - px[j];
            let dy = py[i] - py[j];
            let distanceSquared = dx * dx + dy * dy;
            if (distanceSquared < 0.0001) {
              dx = hash(`x${i}`) - 0.5;
              dy = hash(`y${j}`) - 0.5;
              distanceSquared = 0.0001;
            }
            const push = idealSquared / distanceSquared;
            fx[i] += dx * push;
            fy[i] += dy * push;
            fx[j] -= dx * push;
            fy[j] -= dy * push;
          }
        }
      }
    }
    for (const [a, b] of links) {
      const dx = px[a] - px[b];
      const dy = py[a] - py[b];
      const distance = Math.hypot(dx, dy) || 0.01;
      const pull = distance / ideal;
      fx[a] -= dx * pull;
      fy[a] -= dy * pull;
      fx[b] += dx * pull;
      fy[b] += dy * pull;
    }
    const limit = ideal * 0.5 * cooling + 0.5;
    for (let i = 0; i < count; i++) {
      const anchor = anchorOf[i];
      fx[i] += ((anchor?.x ?? width / 2) - px[i]) * (anchor ? GROUP_PULL : 0.01);
      fy[i] += ((anchor?.y ?? height / 2) - py[i]) * (anchor ? GROUP_PULL : 0.01);
      const size = Math.hypot(fx[i], fy[i]) || 1;
      const move = Math.min(size, limit);
      px[i] += (fx[i] / size) * move;
      py[i] += (fy[i] / size) * move;
    }
  }
  const mx = marginX(width);
  const low = (values) => values.reduce((a, b) => Math.min(a, b), Infinity);
  const high = (values) => values.reduce((a, b) => Math.max(a, b), -Infinity);
  const minX = low(px);
  const minY = low(py);
  const spanX = high(px) - minX || 1;
  const spanY = high(py) - minY || 1;
  const fitX = (width - mx * 2) / spanX;
  const fitY = (height - MARGIN_Y * 2) / spanY;
  const even = Math.min(fitX, fitY);
  const scaleX = Math.min(fitX, even * MAX_STRETCH);
  const scaleY = Math.min(fitY, even * MAX_STRETCH);
  const offsetX = (width - spanX * scaleX) / 2;
  const offsetY = (height - spanY * scaleY) / 2;
  return Array.from(px, (x, i) => ({ x: offsetX + (x - minX) * scaleX, y: offsetY + (py[i] - minY) * scaleY }));
}

function gridPlacement(count, width, top, bottom) {
  const columns = Math.max(1, Math.floor((width - marginX(width) * 2) / GAP));
  const rows = Math.ceil(count / columns);
  const gapY = Math.min(GAP, rows > 1 ? (bottom - top) / (rows - 1) : GAP);
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / columns);
    const inRow = Math.min(columns, count - row * columns);
    const col = i % columns;
    return { x: width / 2 + (col - (inRow - 1) / 2) * GAP, y: top + row * gapY };
  });
}

export function layoutGraph(graph, { width, height }) {
  const count = graph.nodes.length;
  if (!count) return { nodes: [], edges: graph.edges };
  const linkedIds = new Set(graph.edges.flatMap(({ source, target }) => [source, target]));
  const linked = graph.nodes.filter(({ id }) => linkedIds.has(id));
  const loose = graph.nodes.filter(({ id }) => !linkedIds.has(id));
  const positions = new Map();
  if (!loose.length || !linked.length) {
    const placed = linked.length ? forceLayout(graph, width, height) : count === 1 ? [{ x: width / 2, y: height / 2 }] : gridPlacement(count, width, MARGIN_Y, height - MARGIN_Y);
    graph.nodes.forEach(({ id }, i) => positions.set(id, placed[i]));
  } else {
    const columns = Math.max(1, Math.floor((width - marginX(width) * 2) / GAP));
    const bandHeight = Math.min(height * 0.3, Math.ceil(loose.length / columns) * GAP);
    const coreHeight = height - bandHeight - MARGIN_Y;
    const core = forceLayout({ nodes: linked, edges: graph.edges }, width, coreHeight);
    linked.forEach(({ id }, i) => positions.set(id, core[i]));
    const band = gridPlacement(loose.length, width, coreHeight + MARGIN_Y / 2, height - MARGIN_Y / 2);
    loose.forEach(({ id }, i) => positions.set(id, band[i]));
  }
  const round = (value) => Math.round(value * 10) / 10;
  const nodes = graph.nodes.map((node) => ({ ...node, x: round(positions.get(node.id).x), y: round(positions.get(node.id).y) }));
  return { nodes, edges: graph.edges };
}
