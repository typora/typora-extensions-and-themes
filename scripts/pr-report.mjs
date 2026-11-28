#!/usr/bin/env node
// The pull request's review report and the `review-policy` status
// (.github/workflows/pr-report.yml, on workflow_run: trusted, with a write
// token). The results it reads were made from the pull request's files: they
// are data, checked for shape and escaped, never run.
//
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=… HEAD_SHA=<sha> CHECKS_CONCLUSION=success \
//     node scripts/pr-report.mjs results/
//
// results/ may hold static.json (scripts/pr-check.mjs), permissions.json
// (scripts/permission-diff.mjs) and runtime.json (scripts/harness/harness.mjs).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEVELS } from "./review/findings.mjs";
import { gh, ghAll, md, repo, upsertComment } from "./review/github.mjs";
import { assess } from "./review/risk.mjs";
import { gateFor } from "./pr-gate.mjs";

const MARKER = "<!-- typora-pr-checks -->";
const CONTEXT = "review-policy";

const readJson = (dir, name) => {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/** Keep only well-formed findings with plain fields. */
function cleanFindings(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((f) => f && LEVELS.includes(f.level) && typeof f.rule === "string" && typeof f.message === "string")
    .map((f) => ({
      level: f.level,
      rule: f.rule.slice(0, 80),
      id: typeof f.id === "string" ? f.id.slice(0, 80) : null,
      file: typeof f.file === "string" ? f.file.slice(0, 300) : null,
      line: Number.isInteger(f.line) ? f.line : null,
      message: f.message.slice(0, 600),
      waived: f.waived ? { reason: String(f.waived.reason ?? "").slice(0, 300) } : undefined,
    }));
}

const PATH = /^[\w.@/-]+$/;

function link(packages, headSha, f) {
  const base = packages?.[f.id];
  if (!f.file || typeof base !== "string" || !PATH.test(base) || !PATH.test(f.file)) return f.file ? `\`${md(f.file)}\`` : "";
  const label = `${f.file}${f.line ? `:${f.line}` : ""}`;
  return `[\`${md(label)}\`](https://github.com/${repo()}/blob/${headSha}/${base}/${f.file}${f.line ? `#L${f.line}` : ""})`;
}

export function render({ risk, rows, problems, staticResult, runtime, headSha, checks }) {
  const icon = { error: "❌", review: "👀", warn: "⚠️", info: "ℹ️" };
  const findings = [...cleanFindings(staticResult?.findings), ...cleanFindings(runtime?.findings)];
  const packages = staticResult?.packages ?? {};
  let out = `### Review: **${risk.level}** risk\n\n`;
  if (risk.reasons.length) out += `${risk.reasons.map((r) => `- ${r}`).join("\n")}\n\n`;
  out += `Checks on \`${headSha.slice(0, 7)}\`: ${md(checks)}.\n\n`;

  if (rows.length) {
    out += "#### Permissions\n\n| Package | Status | Version | Tier | Permissions | Change |\n| --- | --- | --- | --- | --- | --- |\n";
    for (const r of rows)
      out += `| \`${md(r.id)}\` | ${md(r.status)} | ${md(r.version)} | ${md(r.tier)} | ${md(r.perms)} | ${md(r.change).replace(/&lt;br&gt;|\\<br\\>/g, "<br>")} |\n`;
    out += "\n";
  }
  if (problems.length) out += `${problems.map((p) => `- ❌ ${md(p)}`).join("\n")}\n\n`;

  const shown = findings.filter((f) => f.level !== "info");
  if (shown.length) {
    out += "#### Findings\n\n";
    for (const f of shown)
      out += `- ${icon[f.level]} \`${md(f.rule)}\` ${f.id ? `\`${md(f.id)}\` ` : ""}${link(packages, headSha, f)} ${md(f.message)}\n`;
    out += "\n";
  }
  const waived = findings.filter((f) => f.waived);
  if (waived.length) out += `#### Waived\n\n${waived.map((f) => `- \`${md(f.rule)}\` ${link(packages, headSha, f)} ${md(f.waived.reason)}`).join("\n")}\n\n`;

  // Sensitive call sites: what the reviewer reads.
  const sites = findings.filter((f) => f.rule === "api/call-site" || f.rule === "api/process-call");
  if (sites.length) {
    out += "#### Where permissions are used\n\n";
    const byNeed = new Map();
    for (const f of sites) {
      const key = `${f.id} — ${f.message}`;
      if (!byNeed.has(key)) byNeed.set(key, []);
      byNeed.get(key).push(link(packages, headSha, f));
    }
    for (const [key, links] of byNeed) out += `- [ ] ${md(key)}: ${links.slice(0, 20).join(", ")}${links.length > 20 ? ", …" : ""}\n`;
    out += "\n";
  }
  const verified = findings.filter((f) => f.rule === "vendor/verified");
  if (verified.length) out += `<details><summary>Vendored files matching their published packages (${verified.length})</summary>\n\n${verified.map((f) => `- \`${md(f.id)}\` ${md(f.message)}`).join("\n")}\n</details>\n\n`;

  if (runtime && Array.isArray(runtime.packages)) {
    out += "#### In the sandbox\n\n";
    for (const p of runtime.packages) {
      if (!p || typeof p.id !== "string") continue;
      const parts = [];
      if (p.activated !== undefined) parts.push(p.activated ? "activates" : "**does not activate**");
      if (Number.isInteger(p.pages)) parts.push(`${p.pages} page(s) load`);
      if (Number.isInteger(p.renders)) parts.push(`${p.renders} fence render(s)`);
      if (Array.isArray(p.requests) && p.requests.length)
        parts.push(`requests: ${p.requests.slice(0, 10).map((r) => `\`${md(String(r))}\``).join(", ")}`);
      if (Array.isArray(p.programs) && p.programs.length)
        parts.push(`programs: ${p.programs.slice(0, 10).map((r) => `\`${md(String(r))}\``).join(", ")}`);
      out += `- \`${md(p.id)}\`: ${parts.join("; ") || "nothing to run"}\n`;
    }
    const run = process.env.CHECKS_RUN_URL;
    if (run && /^https:\/\/github\.com\//.test(run)) out += `\nScreenshots are in the run's \`runtime-results\` artifact: ${run}\n`;
  }
  return out;
}

async function main() {
  const dir = process.argv[2] ?? "results";
  const headSha = process.env.HEAD_SHA;
  if (!/^[0-9a-f]{40}$/.test(headSha ?? "")) throw new Error("HEAD_SHA must be a commit sha.");
  const pulls = await ghAll(`/repos/${repo()}/pulls?state=open`);
  const pr = pulls.find((p) => p.head.sha === headSha);
  if (!pr) {
    console.log(`No open pull request has ${headSha} as its head.`);
    return;
  }
  const staticResult = readJson(dir, "static.json");
  const runtime = readJson(dir, "runtime.json");
  const permissions = readJson(dir, "permissions.json");
  const rows = Array.isArray(permissions?.rows) ? permissions.rows.filter((r) => r && typeof r.id === "string") : [];
  const problems = Array.isArray(permissions?.problems) ? permissions.problems.map(String) : [];
  const { result: gateResult } = await gateFor(pr.number);
  const findings = [...cleanFindings(staticResult?.findings), ...cleanFindings(runtime?.findings), ...cleanFindings(gateResult.findings)];
  const risk = assess({ rows, findings, gate: gateResult.facts });
  const checks = process.env.CHECKS_CONCLUSION ?? "unknown";

  // Merging is the maintainer's approval: the status only says whether the checks found errors.
  const failing = checks !== "success" || findings.some((f) => f.level === "error");
  const state = failing ? "failure" : "success";
  const description = failing ? "Checks have errors; fix them first." : `${risk.level} risk: checks pass.`;
  await gh(`/repos/${repo()}/statuses/${headSha}`, {
    method: "POST",
    body: { state, context: CONTEXT, description: description.slice(0, 140), target_url: process.env.CHECKS_RUN_URL || undefined },
  });
  await upsertComment(pr.number, MARKER, render({ risk, rows, problems, staticResult, runtime, headSha, checks }));
  console.log(`#${pr.number}: ${risk.level} risk → ${state}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exit(2);
  });
