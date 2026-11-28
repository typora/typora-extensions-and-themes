# Contributing an extension

Every extension in the store lives in this repository as source. New
extensions and updates are pull requests; Typora's CI builds and publishes
exactly what was reviewed. Review complements the sandbox rather than
replacing it: extensions still run in a sandbox with the permissions they
declare, so reviewers check those permissions and the code that uses them,
not every line for escapes.

## Submitting

- One extension per pull request, in `extensions/<id>/`. The folder name
  equals the manifest `id` (`author.name`: lowercase letters, digits, dots,
  hyphens). The id is permanent.
- `name`, `version` (semver) and a one-sentence `description` are required;
  `author`, `tags` and `keywords` help people find it. `tags` are the
  store's filters: `Language Pack`, `Markdown Extension`, `Diagram`,
  `Math`, `Theme`, `Writing`, `Template`, `AI`, `Media`, `Image Uploader`,
  `Export`, `Publish`, `Data Sync`, `Productivity`, `File Viewer`, `View`, `Developer`.
  Give image uploaders (`contributes.imageUploaders`) the `Image Uploader`
  tag: Typora's *Settings ▸ Image* uploader menu links to that filter.
- For an extension still in development, set `"unlisted": true` in
  `typora-extension.json`. It is omitted from homepage cards, website and app
  search results, and the sitemap; its detail page requests `noindex`. Its
  direct URL and downloads still work. Omit the key or set it to `false` to
  list it publicly. The JSON catalog retains the record for direct-link
  installation, so this is discoverability control, not access control.
  Give sync providers the `Data Sync` tag.
- An extension that only works on some platforms lists them in `os`
  (`["darwin"]`, `["darwin", "win32"]`; values `darwin`, `win32`,
  `linux`). The store marks it *macOS only* and Typora elsewhere shows it as
  unavailable. Leave `os` out when it runs everywhere.
- Store images (not packaged), Typora showing the extension at work:
  - `cover.webp`: 800 × 400 (2:1), on the store card. Crop it from the
    screenshot without the window title bar.
  - `screenshot.webp`: 1760 × 1100 (16:10, a 880 × 550 window at 2x, no
    scrollbars), on the extension's page.
  Use lossless WebP for screenshots so text stays sharp, and keep each
  image under 300 KB (validate warns). PNG and JPEG also work, up to 1 MB.
  Language packs get both from `scripts/language-pack-images.mjs`.
- Bump `version` with every change to the folder. Published downloads are
  immutable; CI fails a PR that changes files without a bump. Store images
  alone are exempt, except a theme's cover, which is packaged.
- A `README.md` in the folder is shown on the extension's store page. An
  image uploader that drives a companion app (iPic, uPic, …) names the app,
  links where to get it and says what the extension sends it.
- Third-party files are registered in `.typora/vendor.json` with where they
  came from, so CI can compare them byte for byte with the published package:
  `node scripts/review/vendor.mjs add <id> vendor/lib.js npm:lib@1.2.3/dist/lib.js`
  (a folder ends in `/`; an https URL works for a single file). Something you
  bundled yourself is `{ "built": "how", "sha256": "…" }` and gets a human
  look at the recipe.
- Fence renderers render their examples in CI: the fences in `snippets/` and
  in `.typora/fixtures/*.md`. Add the cases you fixed or care about there.
  `.typora/` is not packaged and needs no version bump.
- Run `npm run validate` and `node scripts/pr-check.mjs <id>` before pushing;
  `node scripts/harness/harness.mjs <id>` runs the extension in the sandbox
  (`npx playwright install chromium webkit` once).

## Automated checks (every PR)

CI checks a pull request with the base branch's scripts and reads the pull
request as data, so a pull request cannot change how it is checked. The
results come back as one comment on the pull request.

- **Gate** (before anything runs): the pull request changes one package
  folder and nothing else — `scripts/`, `tests/`, `.github/`, `review/` and
  the other tooling are for maintainers. A new package's namespace (`author`
  in `author.name`) is yours: `review/owners.json` records it after your
  first package, and others cannot add packages to it. `typora.*` is
  Typora's. Names that read like an existing package or namespace are
  flagged. The description explains every permission.
- **Manifest and files**: required fields, id pattern, folder name,
  permission shapes, every referenced file exists; no symbolic links, at most
  1 MB per file and 5 MB per extension (language packs and MathJax fonts:
  32 MB per dictionary, 8 MB per font file, 128 MB per extension); no
  programs or archives under any name, WebAssembly only with its origin,
  no credentials, bundled fonts with their license.
- **Third-party files**: registered ones are compared with their published
  package and checked against known vulnerabilities (osv.dev);
  unregistered ones under `vendor/` need a reviewer.
- **Code** (your own sources): no `eval`, `Function()`, strings in
  `setTimeout`, remote imports, minified or obfuscated code. Every import and
  `src` exists with the same case and stays in the package; pages have no
  inline scripts, handlers or remote resources (the page CSP blocks them).
  Every SDK call is matched with the permission it needs and where it runs
  (`ai` and `process` are main only, …); a permission nothing uses is
  flagged. The calls that use permissions are listed for the reviewer.
- **Manifest patterns**: a regex that nests repetition (`(a+)+`) is refused.
- **Themes**: text, headings, links and secondary text keep their contrast
  against the background in every color scheme.
- **Permission diff** against `main`: permissions added or removed, network
  origins, tier change; a changed package needs a version bump.
- **In the sandbox** (Chromium and WebKit, Typora's own Worker bootstrap,
  view SDK and CSPs, no network): `main` and `background` activate and
  deactivate, every command in `contributes.commands` is registered, every
  page loads, fence renderers draw their examples into SVG Typora accepts and
  survive hostile input. Network requests and programs are recorded, and a
  request that carries the test document's text is reported.

## Review depth follows permissions

`review-policy` passes when the checks find no errors; a maintainer's merge
is the approval. The review comment rates the pull request's risk, which says
how closely the maintainer reads it:

| Risk | When |
| --- | --- |
| low | L0 (data only), no `network` |
| medium | Ships code, or vendors a library |
| high | Declares `network`, `document`, `workspace`, `clipboard` or `ai`; a first contribution; a new namespace; anything the checks ask a reviewer to look at |
| critical | Declares `process`; an update that widens permissions (users consent again); a change from outside the package's namespace; tooling; a waived finding |

From high up, the maintainer goes through every listed call before merging.

A maintainer can accept a finding in `review/waivers.json` with the reason.

## Rules

- **No remote code.** Everything that runs ships in the package. Do not
  load scripts, styles or WebAssembly from the network, and do not `eval`
  or `new Function` anything that was fetched or read from a document.
- **No minified or obfuscated sources.** Commit readable source. If you
  use a build step, commit its output in readable form together with the
  source, and say so in the PR.
- **Ask for the least.** Request only the permissions you use; list
  network origins exactly (`https://kroki.io`, not `https://*`); for the
  user's own server use `{config.<setting>}` with an empty default. Explain
  each permission in the PR description.
- **Programs come from the system or from source.** With `process`, run
  programs the user has (a shell, `git`, `pandoc`) or ones Typora's CI
  builds from source in this repository; prebuilt `binaries` are not
  accepted. Name the commands (`["git"]`) unless the extension is a
  terminal; `"*"` needs a reason in the PR description.
- **Widening permissions needs re-review.** Adding an origin, going from
  `document: read` to `write`, or adding `workspace` / `clipboard` is a
  separate, explicit change in the PR description.
- **Documents are data.** Treat fence bodies, front matter and file
  contents as untrusted input.
- Keep the package small: no `node_modules`, no build caches, no test
  fixtures that users do not need. Dotfiles are not packaged.

Reviewers may ask for changes or decline extensions that duplicate built-in
features, collect data without saying so, or are not maintained. A
published version that turns out to be harmful is revoked and disabled in
the app.

See the [developer guide](https://docs.typora.io/extensions/) for the
manifest, contribution points and the runtime API.

## Publishing adapters

A blog integration contributes `publishAdapters` and registers it with
`typora.publish.registerAdapter` in main. Use the Publish tag, exact API
origins and mocked API tests. See [the adapter contract](https://docs.typora.io/extensions/contributes/publish-adapters)
and the repository `docs/publish.md`. Export and Publish are separate tags;
use both only when both capabilities are implemented.

## Contributing a theme

Themes live in `themes/<id>/`, not `extensions/`, and appear on
[themes.typora.io](https://themes.typora.io). Write the theme first:
<https://docs.typora.io/extensions/themes>. Then:

- Add a `typora-extension.json` as above, with the tag `Theme`, that
  contributes only `themes`. No `main`, `background`, `binaries` or
  `permissions`, and no other contributions: `npm run validate` refuses them.
- Keep each theme in `themes/<id>/themes/<name>/`. Set `name`, `color-scheme`
  and `author` in `theme.toml`.
- Prefer one theme with `color-scheme = "auto"` over separate light and dark
  themes.
- Bundle fonts, with their licenses, rather than naming ones people may not
  have. Credit the fonts and any theme you forked in `README.md`.
- Store images: `cover.webp` is 5:4 and at least 1000 pixels wide, as browsers
  scale it down; `screenshot.webp` is 1760 × 1100 (16:10).
  `node scripts/theme-images.mjs <id>` takes both from the real app, or provide
  your own. The cover goes into the package too: Typora shows it as the theme's
  preview in Settings.

Reviewers check the look on the sample document, that `theme.css` only
decorates (sizes and margins belong in `theme.toml`), and font licenses.
