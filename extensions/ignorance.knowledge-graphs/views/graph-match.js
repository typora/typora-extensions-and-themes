(() => {
  const fold = (value) => value.normalize("NFKC").toLowerCase();

  function parseQuery(text) {
    const terms = [];
    for (const word of fold(text).split(/\s+/)) {
      if (!word) continue;
      if (word.startsWith("#")) {
        if (word.length > 1) terms.push({ kind: "tag", value: word.slice(1) });
      } else if (word.startsWith("path:")) {
        if (word.length > 5) terms.push({ kind: "path", value: word.slice(5) });
      } else {
        terms.push({ kind: "name", value: word });
      }
    }
    return terms.length ? terms : null;
  }

  function matchNode(terms, node, info) {
    if (!terms) return true;
    return terms.every(({ kind, value }) => {
      if (kind === "name") return fold(node.name).includes(value);
      if (kind === "path") return Boolean(node.path) && fold(node.path).includes(value);
      return (info?.tags ?? []).some((tag) => fold(tag).includes(value));
    });
  }

  // The nearest visible node inside a 90 degree cone around the arrow direction.
  function nextNode(from, nodes, [dx, dy]) {
    let best;
    let bestScore = Infinity;
    for (const node of nodes) {
      if (node.id === from.id) continue;
      const x = node.x - from.x;
      const y = node.y - from.y;
      const along = x * dx + y * dy;
      const across = Math.abs(x * dy - y * dx);
      if (along <= 0 || across > along) continue;
      const score = along * along + across * across * 2;
      if (score < bestScore) { best = node; bestScore = score; }
    }
    return best;
  }

  globalThis.graphMatch = { parseQuery, matchNode, nextNode };
})();
