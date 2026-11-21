// Mermaid.js — a static fence renderer (docs/extensions.md §6.3): draws
// ```mermaid fences with the official library instead of Typora's built-in
// renderer (Pele). The library loads the first time a diagram is drawn.
// Nothing leaves the computer.

const view = typora.view;

let library = null;

function loadMermaid() {
  // An absolute URL: in the sandboxed page a relative import() has no base.
  library ??= import(new URL("vendor/mermaid.esm.min.mjs", document.baseURI).href).then((module) => module.default);
  library.catch(() => (library = null));
  return library;
}

let renderId = 0;

view.onRender(async ({ source, theme }) => {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    // Keep HTML labels; Typora sanitizes the SVG again before showing it.
    securityLevel: "antiscript",
    theme: theme.dark ? "dark" : "base",
    darkMode: theme.dark,
    fontFamily: "sans-serif",
    altFontFamily: "sans-serif",
    themeVariables: {
      background: theme.background,
      primaryColor: theme.panel,
      primaryTextColor: theme.foreground,
      primaryBorderColor: theme.border,
      lineColor: theme.foreground,
      textColor: theme.foreground,
      noteBkgColor: theme.panel,
      noteTextColor: theme.foreground,
    },
    flowchart: { htmlLabels: true, useMaxWidth: true },
    sequence: { useMaxWidth: false, diagramMarginX: 8, diagramMarginY: 8, boxMargin: 8 },
    gantt: { leftPadding: 75, rightPadding: 20 },
  });
  const id = `mermaid-${++renderId}`;
  try {
    const { svg } = await mermaid.render(id, source);
    // Mermaid returns HTML-flavoured markup (unclosed <br>, &nbsp;, xlink:href without
    // its namespace). Typora parses the result as XML, so serialize it as XML first.
    const box = document.createElement("div");
    box.innerHTML = svg;
    const element = box.querySelector("svg");
    if (!element) return { svg };
    if (!element.getAttribute("xmlns:xlink")) element.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    return { svg: new XMLSerializer().serializeToString(element) };
  } finally {
    // After a parse error Mermaid can leave its measuring element behind.
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
  }
});
