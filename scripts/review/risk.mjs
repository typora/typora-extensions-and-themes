// How closely a maintainer reviews a pull request (CONTRIBUTING.md, "Review
// depth follows permissions"), from what the checks found. The sandbox bounds what
// an extension can do; review decides whether it does it honestly, so the
// depth follows its permissions and how they change, not its size.

export const RISK_LEVELS = ["low", "medium", "high", "critical"];

/**
 * rows: scripts/permission-diff.mjs rows (with `facts`)
 * findings: static + runtime findings
 * gate: facts from scripts/review/gate.mjs
 */
export function assess({ rows = [], findings = [], gate = {} }) {
  const reasons = { low: [], medium: [], high: [], critical: [] };
  for (const row of rows) {
    const f = row.facts;
    if (!f) continue;
    if (f.permissions?.process) reasons.critical.push(`\`${row.id}\` can run programs (process)`);
    if (f.widened) reasons.critical.push(`\`${row.id}\` widens its permissions: ${f.added.join(", ")}`);
    if (f.sensitive && !f.permissions?.process) reasons.high.push(`\`${row.id}\` declares ${Object.keys(f.permissions).join(", ")}`);
    if (f.tierNow === "L1" || f.tierNow === "L2") reasons.medium.push(`\`${row.id}\` ships code (${f.tierNow})`);
  }
  if (gate.notOwner) reasons.critical.push("changes a package in someone else's namespace");
  if (gate.tooling) reasons.critical.push("changes the store's tooling");
  if (findings.some((f) => f.waived)) reasons.critical.push("a maintainer waived a finding");
  if (gate.firstTime) reasons.high.push("first contribution from this author");
  if (gate.newNamespace) reasons.high.push("a new namespace");
  const toReview = findings.filter((f) => f.level === "review");
  if (toReview.length) reasons.high.push(`${toReview.length} finding(s) need a reviewer's look`);
  if (findings.some((f) => f.rule === "vendor/verified")) reasons.medium.push("vendors third-party code");
  const level = [...RISK_LEVELS].reverse().find((l) => reasons[l].length) ?? "low";
  return { level, reasons: reasons[level], all: reasons };
}
