#!/usr/bin/env node
// Drives the Cursor cloud-agent deep review for .github/workflows/ai-review.yml.
//
//   node scripts/ai-review.mjs guard <kind>   → the "Tooling guard" / "Content guard" job (tooling | content)
//   node scripts/ai-review.mjs plan           → run=… reason=… forced=… runs=… (for $GITHUB_OUTPUT)
//   node scripts/ai-review.mjs scan <dir…>    → content-rule matches in local folders
//   node scripts/ai-review.mjs start          → agent_id=… agent_url=… (or ai-review-status.json)
//   node scripts/ai-review.mjs wait           → the agent's final message on stdout
//   node scripts/ai-review.mjs report <file>  → sticky PR comment + "AI review" check run
//
// Everything that comes from the PR (file names, manifests, body, the agent's
// echo of PR content) is treated as text: read through the GitHub API, never
// checked out or executed, never interpolated into a shell, and neutralised
// before it is posted back to GitHub.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.cursor.com/v1";
const MARKER = "<!-- typora-ai-review";
const STATUS_FILE = "ai-review-status.json";
const env = (name) => process.env[name] ?? "";
const repo = () => env("REPO");
const pr = () => env("PR_NUMBER");

// ── Trigger rules ───────────────────────────────────────────────────────────
// Only changes that can execute, reach the network or run programs are worth
// an AI review. Pure data (translations, dictionaries, snippets, templates,
// themes, store images, READMEs) is left to the deterministic checks.
const PACKAGE_FILE = /^(extensions|themes)\/([^/]+)\/(.+)$/;
const CODE_FILE = /\.(m?js|cjs|jsx|ts|tsx|html?|wasm)$/i;
const MANIFEST = "typora-extension.json";
const CODE_KEYS = ["main", "background", "binaries", "permissions"];
// Contributors don't change the store's tooling: such a PR fails the "Tooling
// guard" job instead of being reviewed, unless a maintainer adds `allow-tooling`.
const TOOLING =/^(scripts\/|tests\/|\.github\/|\.cursor\/|review\/|site\/|package(-lock)?\.json$|worker\.js$|headers\.js$|wrangler[^/]*\.toml$)/;
const TRUSTED_AUTHORS = ["OWNER", "MEMBER", "COLLABORATOR"];
const MAX_RUNS_PER_PR = Number(env("AI_REVIEW_MAX_PER_PR") || 5);
const MAX_RUNS_PER_DAY = Number(env("AI_REVIEW_MAX_PER_DAY") || 20);

// stderr is captured: a missing file (404) is an expected answer, and real errors carry it in the exception.
const gh = (args, input) =>
  execFileSync("gh", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
const ghJson = (path) => JSON.parse(gh(["api", path]));
const ghPages = (path) => JSON.parse(gh(["api", path, "--paginate", "--slurp"])).flat();

/** A manifest at a commit, or null. Read as data through the API. */
function manifestAt(path, ref) {
  try {
    const file = ghJson(`repos/${repo()}/contents/${encodeURI(path)}?ref=${ref}`);
    return JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Why a set of changed files needs an AI review; empty when it's data only. */
function reasonsFor(files, { base, head }) {
  const reasons = new Set();
  for (const path of paths(files)) {
    const m = path.match(PACKAGE_FILE);
    if (m && CODE_FILE.test(m[3])) reasons.add(`code in ${m[2]}`);
    else if (m && m[3] === MANIFEST) {
      const keys = [manifestAt(path, base), manifestAt(path, head)]
        .filter(Boolean)
        .flatMap((manifest) => CODE_KEYS.filter((key) => manifest[key] !== undefined));
      if (keys.length) reasons.add(`${m[2]} declares ${[...new Set(keys)].join(", ")}`);
    }
  }
  return [...reasons];
}

/** Every path a change touches, including the old name of a rename. */
const paths = (files) => [...new Set(files.flatMap((f) => [f.filename, f.previous_filename]).filter(Boolean))];

/** The sticky comment, and the head / run count recorded in its marker. */
function stickyComment() {
  const comment = ghPages(`repos/${repo()}/issues/${pr()}/comments`).find(
    (c) => c.user?.login === "github-actions[bot]" && c.body?.startsWith(MARKER),
  );
  const marker = comment?.body.match(/^<!-- typora-ai-review head=([0-9a-f]*) runs=(\d+) -->/);
  return { comment, lastHead: marker?.[1] || null, runs: Number(marker?.[2] ?? 0) };
}

// ── Guards ──────────────────────────────────────────────────────────────────
// Each guard is a job of its own, and that job is the required check: a check
// run posted through the API lands in the commit's oldest check suite, and a
// suite a superseded run left cancelled hides it from the merge box.

/** `guard <kind>`: the job's summary says why; a failure fails the job. */
function guard(kind) {
  const run = { tooling: toolingGuard, content: contentGuard }[kind];
  if (!run) throw new Error(`Unknown guard: ${kind}`);
  const data = ghJson(`repos/${repo()}/pulls/${pr()}`);
  const files = ghPages(`repos/${repo()}/pulls/${pr()}/files?per_page=100`);
  run(data, files, data.labels.map((l) => l.name));
}

function verdict(conclusion, title, summary) {
  console.log(`${conclusion === "failure" ? "::error::" : ""}${title}\n\n${summary}`);
  if (env("GITHUB_STEP_SUMMARY")) appendFileSync(env("GITHUB_STEP_SUMMARY"), `### ${title}\n\n${summary}\n`);
  if (conclusion === "failure") process.exitCode = 1;
}

/** Fails a contributor PR that changes the tooling. */
function toolingGuard(data, files, labels) {
  const tooling = paths(files).filter((p) => !PACKAGE_FILE.test(p) && TOOLING.test(p));
  if (!tooling.length) return verdict("success", "No tooling changes", "Only package folders changed.");
  if (TRUSTED_AUTHORS.includes(data.author_association))
    return verdict("success", "Tooling changes by a maintainer", "The author can change the tooling; CODEOWNERS review applies.");
  const list = tooling.map((p) => `- \`${clean(p, 200)}\``).join("\n");
  if (labels.includes("allow-tooling"))
    return verdict("success", "Tooling changes accepted by a maintainer", `Accepted with \`allow-tooling\`:\n\n${list}`);
  verdict(
    "failure",
    "Contributors can't change the store tooling",
    `This PR changes files outside \`extensions/\` and \`themes/\`:\n\n${list}\n\nMove those changes to a separate issue or PR for the maintainers. A maintainer can accept them here with the \`allow-tooling\` label.`,
  );
}

// Content that has no business in an extension: reaching for the user's or
// CI's secrets, sending data to catch-all endpoints, talking to reviewers or
// AI, and invisible characters. Each rule had zero hits across the store when
// it was written; widen them only with that check (`scan extensions themes`).
const ZERO_WIDTH = "​-‍⁠﻿";
const CONTENT_RULES = [
  {
    id: "credential-path",
    message: "names a credential location",
    re: /\.ssh\/|\bid_(rsa|ed25519|ecdsa)\b|\.aws\/credentials|\.netrc\b|\.npmrc\b|\.git-credentials|\.docker\/config\.json|find-generic-password|\/proc\/self\/environ/i,
  },
  {
    id: "secret-name",
    message: "names a CI or service secret",
    re: /\b(GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_(TOKEN|URL)|CURSOR_API_KEY|CLOUDFLARE_API_TOKEN|ALIYUN_PEM)\b/,
  },
  {
    id: "exfil-endpoint",
    message: "uses a catch-all data collection endpoint",
    re: /webhook\.site|requestbin|pipedream\.net|ngrok(-free)?\.(io|app|dev)|interact\.sh|\boast\.(fun|me|pro|live|site|online)|burpcollaborator\.net|discord(app)?\.com\/api\/webhooks|api\.telegram\.org\/bot|pastebin\.com/i,
  },
  {
    id: "prompt-injection",
    message: "addresses reviewers or AI",
    re: /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts?)|disregard (all |any )?(the )?(previous|prior|above) |safe to merge|\b(ai|llm|automated|bot|code)[ -]?review(er|ers)?\b.{0,60}\b(ignore|skip|approve|safe|trust)|\bbugbot\b|<\|im_(start|end)\|>|\[\/?INST\]|UNTRUSTED[_-]PR[_-]DESCRIPTION|typora-ai-review/i,
  },
  { id: "tag-characters", message: "contains invisible Unicode tag characters", re: /[\u{E0000}-\u{E007F}]/u },
  // Translations (Persian, Arabic, Hebrew) use these legitimately; code and manifests don't.
  { id: "bidi-control", message: "contains a bidirectional control character", re: /[‪-‮⁦-⁩]/, code: true },
  // A BOM or ZWNJ inside a string or regex is fine; one touching an identifier hides a different name.
  {
    id: "zero-width-identifier",
    message: "has a zero-width character inside an identifier",
    re: new RegExp(`[\\p{ID_Continue}$][${ZERO_WIDTH}]|[${ZERO_WIDTH}][\\p{ID_Continue}$]`, "u"),
    code: true,
  },
];
const CODE_LIKE = /\.(m?js|cjs|jsx|ts|tsx|html?|css|svg)$|(^|\/)typora-extension\.json$/i;
const TEXT_FILE = /\.(m?js|cjs|jsx|ts|tsx|html?|css|svg|json|md|txt|toml|ya?ml|xml)$/i;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

/** Content-rule hits in one file: [{ rule, message, line, excerpt }]. */
function scanText(path, text) {
  const hits = [];
  const isCode = CODE_LIKE.test(path);
  const lines = text.split("\n");
  for (const rule of CONTENT_RULES) {
    if (rule.code && !isCode) continue;
    lines.forEach((line, i) => {
      const m = line.match(rule.re);
      if (!m) return;
      const at = Math.max(0, m.index - 40);
      const excerpt = line.slice(at, m.index + m[0].length + 40).replace(new RegExp(`[${ZERO_WIDTH}‪-‮⁦-⁩]|[\u{E0000}-\u{E007F}]`, "gu"), (c) => `<U+${c.codePointAt(0).toString(16).toUpperCase()}>`);
      hits.push({ rule: rule.id, message: rule.message, line: i + 1, excerpt });
    });
  }
  return hits;
}

/** Fails a PR whose package files (or, from a contributor, title / description) trip a content rule. */
function contentGuard(data, files, labels) {
  const hits = [];
  for (const file of files) {
    if (file.status === "removed" || !PACKAGE_FILE.test(file.filename) || !TEXT_FILE.test(file.filename)) continue;
    let text;
    try {
      const blob = ghJson(`repos/${repo()}/git/blobs/${file.sha}`);
      if (blob.size > MAX_SCAN_BYTES) continue;
      text = Buffer.from(blob.content, "base64").toString("utf8");
    } catch {
      continue;
    }
    for (const hit of scanText(file.filename, text)) hits.push({ path: file.filename, ...hit });
  }
  if (!TRUSTED_AUTHORS.includes(data.author_association))
    for (const hit of scanText("PR description", `${data.title}\n${data.body ?? ""}`)) hits.push({ path: "PR description", ...hit });

  if (!hits.length) return verdict("success", "No suspicious content", "No content rule matched.");
  const list = hits
    .slice(0, 50)
    .map((h) => `- \`${clean(h.path, 200)}:${h.line}\` **${h.rule}** — ${h.message}: ${code(h.excerpt)}`)
    .join("\n");
  if (labels.includes("allow-content"))
    return verdict("success", "Content accepted by a maintainer", `Accepted with \`allow-content\`:\n\n${list}`);
  verdict(
    "failure",
    `${hits.length} suspicious content match${hits.length === 1 ? "" : "es"}`,
    `${list}${hits.length > 50 ? `\n\n…and ${hits.length - 50} more.` : ""}\n\nExtensions don't touch credentials or secrets, send data to catch-all endpoints, address reviewers or AI, or hide characters. If this is a false positive, a maintainer can accept it with the \`allow-content\` label.`,
  );
}

/** `scan <dir…>`: run the content rules over local folders (to check rules for false positives). */
function scanLocal(dirs) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  let count = 0;
  for (const path of dirs.flatMap(walk)) {
    if (!TEXT_FILE.test(path) || statSync(path).size > MAX_SCAN_BYTES) continue;
    for (const hit of scanText(path, readFileSync(path, "utf8"))) {
      count++;
      console.log(`${path}:${hit.line} ${hit.rule}: ${hit.excerpt.slice(0, 120)}`);
    }
  }
  console.log(`${count} match(es)`);
  process.exitCode = count ? 1 : 0;
}

function plan() {
  const out = (run, reason, extra = {}) => {
    const fields = { run, reason: reason.replace(/\n/g, " ").slice(0, 900), ...extra };
    for (const [k, v] of Object.entries(fields)) console.log(`${k}=${v}`);
    // Say why on the PR's checks, except for events that aren't about this review.
    if (!run && reason !== "unrelated label" && reason !== "PR is not open")
      checkRun("skipped", `AI review skipped: ${clean(reason, 120)}`, clean(fields.reason, 900));
  };
  const action = env("EVENT_ACTION");
  if (action === "labeled" && !["ai-review", "allow-tooling", "allow-content"].includes(env("EVENT_LABEL")))
    return out(false, "unrelated label");

  const data = ghJson(`repos/${repo()}/pulls/${pr()}`);
  const labels = data.labels.map((l) => l.name);
  const forced = labels.includes("ai-review");
  if (data.state !== "open") return out(false, "PR is not open");

  const head = data.head.sha;
  const base = data.base.sha;
  const files = ghPages(`repos/${repo()}/pulls/${pr()}/files?per_page=100`);

  if (labels.includes("no-ai-review")) return out(false, "labelled no-ai-review");
  if (data.draft && !forced) return out(false, "draft");
  if (data.user.type === "Bot" && !forced) return out(false, "bot author");

  const { lastHead, runs } = stickyComment();
  const done = { forced, runs: runs + 1 };

  const reasons = reasonsFor(files, { base, head });
  if (forced) return out(true, `requested by label${reasons.length ? `; ${reasons.join("; ")}` : ""}`, done);
  if (!reasons.length) return out(false, "data only", done);
  if (lastHead === head) return out(false, `already reviewed at ${head.slice(0, 7)}`, done);
  if (runs >= MAX_RUNS_PER_PR) return out(false, `reached ${MAX_RUNS_PER_PR} automatic reviews for this PR; add the ai-review label to run again`, done);

  // Only re-review when something that triggers a review changed since the last one.
  if (lastHead) {
    try {
      const since = ghJson(`repos/${repo()}/compare/${lastHead}...${head}`).files ?? [];
      const changed = reasonsFor(since, { base: lastHead, head });
      if (!changed.length) return out(false, `no code or permission change since ${lastHead.slice(0, 7)}`, done);
      return out(true, `changed since ${lastHead.slice(0, 7)}: ${changed.join("; ")}`, done);
    } catch {
      /* the last head is gone (force push): review the whole PR */
    }
  }
  out(true, reasons.join("; "), done);
}

// ── Cursor API ──────────────────────────────────────────────────────────────
const auth = () => `Bearer ${env("CURSOR_API_KEY")}`;

async function cursor(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: auth(), "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw Object.assign(new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`), { status: res.status });
  return res.json();
}

function prompt() {
  const firstTime = ["FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"].includes(env("PR_ASSOCIATION"));
  const values = {
    PR_NUMBER: pr(),
    PR_URL: env("PR_URL"),
    PR_AUTHOR: env("PR_AUTHOR"),
    REPO: repo(),
    BASE_SHA: env("BASE_SHA"),
    HEAD_SHA: env("HEAD_SHA"),
    FIRST_TIME: firstTime ? "yes" : "no",
    // The closing marker can't appear inside the untrusted block.
    PR_BODY: env("PR_BODY").replaceAll("UNTRUSTED_PR_DESCRIPTION", "UNTRUSTED-PR-DESCRIPTION").slice(0, 20000),
  };
  return readFileSync("review/cursor-deep-review.md", "utf8").replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

const agentName = () => `Review PR #${pr()} @ ${env("HEAD_SHA").slice(0, 7)}`;

/** Recent review agents (newest first, up to 200). */
async function recentReviewAgents() {
  const agents = [];
  let next = "";
  for (let page = 0; page < 2; page++) {
    const res = await cursor(`/agents?limit=100${next ? `&cursor=${next}` : ""}`);
    agents.push(...res.items);
    if (!res.nextCursor) break;
    next = res.nextCursor;
  }
  return agents.filter((a) => a.name?.startsWith("Review PR #"));
}

async function start() {
  const status = (conclusion, title, message) => writeFileSync(STATUS_FILE, JSON.stringify({ conclusion, title, message }));
  try {
    const models = (await cursor("/models")).items;
    const model = env("CURSOR_MODEL");
    if (model && !models.some((m) => m.id === model || m.aliases?.includes(model)))
      throw new Error(`CURSOR_REVIEW_MODEL "${model}" isn't available; choose one of: ${models.map((m) => m.id).join(", ")}`);

    const reviews = await recentReviewAgents();
    // A newer push supersedes a review still running on this PR.
    for (const agent of reviews.filter((a) => a.name.startsWith(`Review PR #${pr()} @`) && a.status === "ACTIVE" && a.latestRunId))
      await cursor(`/agents/${agent.id}/runs/${agent.latestRunId}/cancel`, { method: "POST" }).catch(() => {});
    const today = reviews.filter((a) => Date.now() - Date.parse(a.createdAt) < 24 * 3600 * 1000).length;
    if (today >= MAX_RUNS_PER_DAY && env("FORCED") !== "true")
      return status("skipped", "AI review skipped: daily limit", `${today} reviews in the last 24 hours (limit ${MAX_RUNS_PER_DAY}). Add the ai-review label to run it anyway.`);

    const { agent } = await cursor("/agents", {
      method: "POST",
      body: JSON.stringify({
        name: agentName(),
        prompt: { text: prompt() },
        repos: [{ url: `https://github.com/${repo()}`, startingRef: env("BASE_SHA") }],
        autoCreatePR: false,
        ...(model ? { model: { id: model } } : {}),
      }),
    });
    console.log(`agent_id=${agent.id}`);
    console.log(`agent_url=${agent.url}`);
  } catch (error) {
    status("neutral", "AI review could not start", error.message);
  }
}

async function wait() {
  const id = env("AGENT_ID");
  const deadline = Date.now() + 80 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30_000));
    const agent = await cursor(`/agents/${id}`);
    if (!agent.latestRunId) continue;
    const run = await cursor(`/agents/${id}/runs/${agent.latestRunId}`);
    if (["CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"].includes(run.status)) continue;
    if (run.status !== "FINISHED") throw new Error(`Run ended ${run.status}`);
    process.stdout.write(run.result ?? "");
    return;
  }
  throw new Error("Timed out waiting for the review.");
}

// ── Report ──────────────────────────────────────────────────────────────────
/** The final message is one ```json block; check the parts the report relies on. */
function parse(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  const data = JSON.parse(match ? match[1] : text);
  const ok =
    data &&
    Number(data.pr) === Number(pr()) &&
    data.head_sha === env("HEAD_SHA") &&
    ["block", "changes-requested", "human-review"].includes(data.verdict) &&
    Array.isArray(data.findings) &&
    Array.isArray(data.not_checked);
  if (!ok) throw new Error("The review JSON doesn't match this PR or the schema.");
  return data;
}

/** Text from the PR (via the agent) must not ping people, inject HTML or break tables / code spans. */
const clean = (s, max = 600) =>
  String(s ?? "")
    .slice(0, max)
    .replace(/@(?=[A-Za-z0-9-])/g, "@​")
    .replace(/</g, "&lt;")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
const code = (s) => "`` " + clean(s, 300).replace(/`/g, "ˋ") + " ``";

function render(data) {
  const icon = { block: "⛔", "changes-requested": "⚠️", "human-review": "👀" }[data.verdict];
  const sev = { critical: 0, high: 1, medium: 2, low: 3 };
  const findings = [...data.findings].sort((a, b) => sev[a.severity] - sev[b.severity]);
  let md = `## ${icon} AI review: \`${data.verdict}\`\n\n`;
  md += `Head \`${env("HEAD_SHA").slice(0, 7)}\` · [agent run](${env("AGENT_URL")}) · triggered by: ${clean(env("PLAN_REASON"), 300)} · advisory only — a maintainer still reviews and approves.\n\n`;
  md += `${clean(data.summary, 1200)}\n\n`;
  if (findings.length) {
    md += "| Severity | Category | Where | Finding |\n| --- | --- | --- | --- |\n";
    for (const f of findings) {
      const where = `[${clean(f.file, 200)}:${f.line}](https://github.com/${repo()}/blob/${env("HEAD_SHA")}/${encodeURI(f.file)}#L${f.line})`;
      md += `| **${f.severity}** | ${f.category} | ${where} | ${clean(f.title, 140)}<br>${code(f.evidence)}<br>*Scenario:* ${clean(f.scenario)}<br>*Fix:* ${clean(f.fix)} |\n`;
    }
  } else md += "No findings.\n";
  if (data.permission_review?.length) {
    md += "\n<details><summary>Permissions</summary>\n\n| Package | Permission | Used for | Minimal | In README |\n| --- | --- | --- | --- | --- |\n";
    for (const p of data.permission_review)
      md += `| ${code(p.package)} | ${code(p.permission)} | ${clean(p.used_for, 300)} | ${p.minimal ? "yes" : "**no**"} | ${p.disclosed_in_readme ? "yes" : "**no**"} |\n`;
    md += "\n</details>\n";
  }
  if (data.sensitive_call_sites?.length) {
    md += "\n<details><summary>Sensitive call sites</summary>\n\n";
    for (const c of data.sensitive_call_sites)
      md += `- ${code(c.api)} ${clean(c.file, 200)}:${c.line} → ${clean(c.target ?? "", 200)} — ${clean(c.data_sent_or_used, 300)}\n`;
    md += "\n</details>\n";
  }
  const r = data.runtime ?? {};
  md += `\n**Runtime:** harness ${r.harness ?? "?"}, Typora ${r.typora ?? "?"}${r.canary_leaked ? " — **document canary was sent over the network**" : ""}\n`;
  if (data.not_checked?.length) md += `\n**Not checked:** ${data.not_checked.map((s) => clean(s, 200)).join("; ")}\n`;
  return md;
}

/** Writes the sticky comment; `head` is the last successfully reviewed commit. */
function upsertComment(body, head) {
  const { comment } = stickyComment();
  const full = `${MARKER} head=${head ?? ""} runs=${env("PLAN_RUNS") || 1} -->\n${body}`;
  if (comment) gh(["api", "-X", "PATCH", `repos/${repo()}/issues/comments/${comment.id}`, "-F", "body=@-"], full);
  else gh(["api", "-X", "POST", `repos/${repo()}/issues/${pr()}/comments`, "-F", "body=@-"], full);
}

function checkRun(conclusion, title, summary, name = "AI review") {
  const payload = JSON.stringify({
    name,
    head_sha: env("HEAD_SHA"),
    status: "completed",
    conclusion,
    output: { title, summary: summary.slice(0, 60000) },
  });
  gh(["api", "-X", "POST", `repos/${repo()}/check-runs`, "--input", "-"], payload);
}

function report(file) {
  if (existsSync(STATUS_FILE)) {
    const { conclusion, title, message } = JSON.parse(readFileSync(STATUS_FILE, "utf8"));
    return checkRun(conclusion, title, clean(message, 2000));
  }
  const previous = stickyComment().lastHead;
  let data;
  try {
    if (env("WAIT_OUTCOME") !== "success") throw new Error(`the agent run did not finish (${env("WAIT_OUTCOME")})`);
    data = parse(readFileSync(file, "utf8"));
  } catch (error) {
    const body = `## AI review did not complete\n\n${clean(error.message)} · [agent run](${env("AGENT_URL")})\n`;
    upsertComment(body, previous);
    return checkRun("neutral", "AI review did not complete", body);
  }
  const body = render(data);
  upsertComment(body, env("HEAD_SHA"));
  // Advisory: only a block fails the check, and a maintainer can re-run or override it.
  checkRun(data.verdict === "block" ? "failure" : "neutral", `AI review: ${data.verdict}`, body);
  const labels = ["ai:block", "ai:changes-requested", "ai:human-review"].filter((l) => l !== `ai:${data.verdict}`);
  gh(["pr", "edit", pr(), "-R", repo(), "--add-label", `ai:${data.verdict}`, ...labels.flatMap((l) => ["--remove-label", l])]);
}

const [command, arg, ...rest] = process.argv.slice(2);
if (command === "guard") guard(arg);
else if (command === "plan") plan();
else if (command === "scan") scanLocal([arg, ...rest].filter(Boolean));
else if (command === "start") await start();
else if (command === "wait") await wait();
else if (command === "report") report(arg);
else {
  console.error("Usage: ai-review.mjs guard <tooling|content> | plan | scan <dir…> | start | wait | report <file>");
  process.exit(2);
}
