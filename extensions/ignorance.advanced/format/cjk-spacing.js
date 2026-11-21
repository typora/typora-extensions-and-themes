// Adds a space between CJK characters and Latin letters or digits, leaving
// code, math, links, HTML and front matter untouched.

const CJK = "\\u2e80-\\u2eff\\u2f00-\\u2fdf\\u3040-\\u309f\\u30a0-\\u30fa\\u30fc-\\u30ff\\u3100-\\u312f\\u3200-\\u32ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";
const LATIN = "A-Za-z0-9";
const CJK_THEN_LATIN = new RegExp(`([${CJK}])([${LATIN}\\[(@#$%&+=<])`, "g");
const LATIN_THEN_CJK = new RegExp(`([${LATIN}\\])!%&+=>])([${CJK}])`, "g");

// Inline spans that must not change: code, math, links/images (the URL part), autolinks, HTML tags.
const PROTECTED_INLINE = /(`+)[\s\S]*?\1|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]+>|https?:\/\/[^\s)]+/g;

function spaceText(text) {
  return text.replace(CJK_THEN_LATIN, "$1 $2").replace(LATIN_THEN_CJK, "$1 $2");
}

function spaceLine(line) {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(PROTECTED_INLINE)) {
    out += spaceText(line.slice(last, m.index));
    let kept = m[0];
    // Keep the URL of a link but space its label.
    const link = /^(!?\[)([^\]\n]*)(\]\([^)\n]*\))$/.exec(kept);
    if (link) kept = link[1] + spaceText(link[2]) + link[3];
    out += kept;
    last = m.index + m[0].length;
  }
  return out + spaceText(line.slice(last));
}

export function cjkSpacing(markdown) {
  const lines = markdown.split("\n");
  let fence = null;
  let math = false;
  let front = lines[0] === "---";
  return lines
    .map((line, index) => {
      if (front) {
        if (index > 0 && (line === "---" || line === "...")) front = false;
        return line;
      }
      const marker = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = null;
        return line;
      }
      if (marker) {
        fence = marker[1];
        return line;
      }
      if (line.trim() === "$$") {
        math = !math;
        return line;
      }
      if (math || /^( {4}|\t)/.test(line) || /^\s*</.test(line)) return line;
      return spaceLine(line);
    })
    .join("\n");
}
