# MCPForge — Real Application: UX / UI Design System

**Phase 3 of 4 · Planning stream: REAL PRODUCTION APPLICATION (not the concept console)**
Written 27 Aug 2026 · Companion to `01_GOALS_AND_ROADMAP.md` (Phase 1) and `02_TECHNICAL_ARCHITECTURE.md` (Phase 2)

---

## 0. How to read this document

**Audience, in order:** Phase 4 (autonomy, model routing, Wave 0 task backlog), then the autonomous Claude Code + PowerShell build lane, then any human who extends the portal later.

**What this document is.** Phase 1 set *what must be true and in what order*. Phase 2 set *how it is built*. This document sets **what the human sees and touches** — the token system, the component stack, the information architecture, the write-path interaction design, the two discovery surfaces (human and agent), the environment indicators, the accessibility bar, and the token files as real code artefacts.

**What this document does not do.** It does not re-open Phase 1's settled decisions, does not re-decide the stack, does not resolve D1, and does not invent product scope. Where it makes a call that Phase 2 left open, the call is flagged in §14.

**The hard rule that shapes every screen** (Phase 2 §8.1): **the portal writes to git, not to a database.** Every definitional change is a branch + commit + pull request. Runtime state (audit, probe, approvals, consumption) comes from the gateway's API over the runtime datastore. "Save" therefore never means "written." It means "proposed." That distinction has to be visible in every editing surface, and it is the single most common way this product could be got wrong.

**The second hard rule** (Phase 2 §6.5, R8): the portal talks to the gateway only over its HTTP API. Never in-process. If the portal cannot be switched off with `MCPFORGE_MODE=headless` and leave a working product, headless mode is a fiction and D1 sub-question 2 cannot be priced.

---

## 1. Design principles

Six principles. Each one is a tie-breaker for a decision that will actually come up, not a slogan.

1. **Legibility over persuasion.** The concept console had to convince a room in twenty minutes. The real portal has to be worked in for six hours a day. Where the two conflict — a big narrative hero versus a dense list that fits forty rows — density wins. Every narrative page from the concept console (Overview, Why this / why now, Live Walkthrough, Plan & Decisions) is **removed** from the working portal and lives in the deck instead.
2. **Nothing is true until the manifest says so.** The UI never asserts a property the manifest or probe does not carry. `identity.carries: verified` is written by the probe alone — so the UI renders "verified" in a visually distinct way from "declared," and never lets a person type it. Phase 2's structural honesty rules become visual rules.
3. **State is always on screen.** Which environment, which branch, which change state, which probe status, how stale the data is. A dense console that hides state produces confident wrong actions. Every list row and every detail header carries its state chip.
4. **Write actions are a sequence, never a button.** Plan → confirm → (approve) → execute → reverse is the product's spine (Phase 1 §10). It gets first-class screen space, an explicit state machine, and its own component family. A write tool that can be fired with one click is a bug, not a shortcut.
5. **Colour never carries meaning alone.** Every status is a chip with a word, a shape, and an accessible name. This is an accessibility requirement (§12) but it is also a correctness requirement: a room full of people looking at a projector cannot distinguish `#2E9B57` from `#3E8FAF`.
6. **The agent's experience is a designed surface too.** The card, the `guidance` line, the `choose` block, the `next` string on every error, the `plan` sentence — these are UI. They are written to a style guide (§10), reviewed like UI, and rendered in the portal so a human can see exactly what an agent sees (§10.4).

---

## 2. Personas and their working day

Three personas, carried forward from the concept console's persona pills but re-grounded in daily work rather than demo narration. **Persona is a lens over the same IA, not a different app** — it sets the landing page, the default filters, and the ordering emphasis in the sidebar. It never hides a page: hiding governance surfaces from the people being governed is the failure mode this product exists to prevent.

| | **AI / tool developer** | **Business user** | **MCP admin / governance** |
|---|---|---|---|
| **Represents** | Practice engineer authoring manifests | Finance / procurement person who wants a capability, and who approves writes in their own domain | Platform owner, security reviewer, module steward |
| **Lands on** | `Build` (their open work) | `Requests` | `Approvals` |
| **Core loop** | author manifest → validate → codegen preview → sandbox run → propose PR → answer review comments | describe a need in English → see the verdict → track the request → approve a write against their entity | triage approvals (definitional and runtime) → check probe/enablement backlog → review role scope diffs → investigate a call in the audit |
| **The thing that wastes their time today** | Not knowing whether a change compiles, validates, and stays inside the token budget until CI tells them | Not knowing whether the thing already exists | Not being able to see, in one place, what a role actually grants after a glob expands |
| **The metric they move** | MTB, SA@1, autonomy % | G9 (demand-driven catalogue), TTFC per role | Zero-bypass, SoD findings, probe resolution rate |

**Persona switching** stays in the topbar as it did in the concept console, but in the real portal it is bound to the caller's actual roles: a person only sees personas they hold. A developer who is not an approver sees no approver persona. The pill is a lens, not a privilege escalation — the gateway enforces grants regardless of which pill is selected, and the UI says so in the pill's tooltip.

---

## 3. Component library and stack fit

### 3.1 The recommendation

> **shadcn/ui (Radix UI primitives + Tailwind CSS v4), vendored into the repo at `core/portal/src/components/ui/`, on Next.js App Router + React 19 as decided in Phase 2 §1.2.**
> Plus four specialist libraries, each doing exactly one job: **TanStack Table v8** (dense grids), **CodeMirror 6** (YAML manifest editing and diffs), **@xyflow/react** (consumption graph and the server/tool spider map), **Recharts** (the small number of metric charts).

### 3.2 Why this one

1. **It is source, not a dependency.** `npx shadcn@latest add dialog` writes a plain, readable `.tsx` file into our repo. That matters more here than in a typical app because of the **change model**: a component change is a normal PR with a normal diff, reviewable by the same people who review manifests. A version bump of a black-box component library is not.
2. **Radix gives us the accessibility bar for free where it is hardest.** Focus trapping in the confirm modal, roving tabindex in the facet toolbars, correct `aria-expanded`/`aria-controls` on the sidebar groups, dismissable layers on the tool drawer, and a `Command` primitive (`cmdk`) that is already a correct combobox. §12's requirements are mostly *satisfied by construction* rather than hand-built — and hand-built focus management is exactly the thing an autonomous build lane gets subtly wrong.
3. **Tailwind v4 is CSS-variable-first, so the token file in §13 is the single source of truth.** `@theme` maps our CSS custom properties into utility classes with no JS theme object to keep in sync. There is one place a colour is defined. This is the same "one definition, three consumers" argument Phase 2 §1.2 used for the manifest types, applied to design.
4. **Claude Code can scaffold it autonomously and reliably.** shadcn/ui + Tailwind + Next App Router is one of the highest-density patterns in any coding model's training data, the CLI is deterministic, and the output is plain TSX. This is the stated Phase 1 G8 constraint (the build is autonomous-friendly) applied to the UI layer. A library whose idioms the build lane guesses at will burn more human review time than the library saves.
5. **Non-designers can extend it consistently.** The extension path is: use an existing primitive, use only semantic tokens, never a raw hex. Because raw hexes are lint-blocked (§13.5), "consistent by default" is enforced rather than hoped for.
6. **It theme-switches cleanly.** Dark and light are two sets of CSS custom property values on the same class names. No component knows which theme it is in — which is what makes §4's requirement (a real light mode, not a reskin) tractable.

### 3.3 Why not the alternatives

- **MUI** — the strongest enterprise-component argument, and rejected on three counts: an Emotion runtime that fights React Server Components in the App Router; a JS theme object that would become a second source of truth alongside the CSS token file; and a Material visual language that we would spend real effort suppressing to reach the LTM look. We would pay for the design system twice.
- **Ant Design** — best-in-class dense tables, and the most opinionated visual identity of any option. Re-skinning AntD to coral-on-ink is a fight, and its table is not worth losing the brand over when TanStack Table gives us headless density with our own markup.
- **Mantine** — genuinely good and genuinely close. Rejected because theming is a JS object (same drift problem as MUI, smaller), and because its idioms are thinner in model training data than shadcn's, which directly costs autonomy.
- **Chakra** — runtime CSS-in-JS, RSC friction, same theme-object drift.
- **Radix primitives alone, with our own components on top** — this is literally what shadcn/ui is, minus a year of other people's bug fixes and minus the CLI the build lane can drive. Choosing this is choosing to write shadcn ourselves.
- **A house LTM component library** — *if one exists, it beats everything above.* Phase 2 §1.1 already recorded that ARIA / MORPHED / DEXA have no documented stack in project memory. **If any of them ships a React component library or a design system package, say so and this section is revised.** Alignment with an existing LTM house pattern is worth more than the marginal advantages above. This is flagged as an open question in §14.

### 3.4 The specialists, and their boundaries

| Library | Used for | Explicitly not used for |
|---|---|---|
| **TanStack Table v8** (headless) | Catalog table, audit/run explorer, approvals queue, probe report, role scope table. Column sizing, sorting, virtualised rows past ~200 items. | Anything under 20 rows — that is a plain `<table>` with our `DataTable` styles. Do not reach for the grid engine to render six rows. |
| **CodeMirror 6** | Manifest YAML editing with schema-aware completion from the JSON Schema, inline `forge validate` diagnostics as gutter markers, and the unified/split **diff** view for PRs (`@codemirror/merge`). | A second editor engine. Monaco is explicitly rejected: heavier, worse screen-reader behaviour, and would mean two editors in one app. |
| **@xyflow/react** | Consumption graph (tool → agent → platform), and the server→tool→binding spider map carried over from the concept console. | General layout. It is a canvas for two screens, not a UI framework. Both screens must have an equivalent **table view** (§12 — a canvas is not keyboard-navigable enough to be the only representation). |
| **Recharts** | The Insights metric charts — TTFC/VTC/DH/SA@1/MTB trend per wave, per-role TTFC bars, call volume sparklines. | Anything that is really a table. Most of Insights is numbers with a trend arrow, not a chart. |

Everything else — chips, drawers, dialogs, tabs, command palette, toasts, forms (`react-hook-form` + `zod`, with the zod schema generated from the manifest JSON Schema) — is shadcn/Radix.

**Data fetching:** TanStack Query for all gateway API reads, as Phase 2 §1.2 already anticipated. Git reads use React Server Components directly. That split is worth stating in the design system because it determines which surfaces can show a skeleton loader (client, runtime data) and which are server-rendered whole (git-backed definitional data).

---

## 4. Visual system

### 4.1 Brand anchors — non-negotiable

- **Logo:** the real asset `LTM_Coral.svg`, viewBox `0 0 3800 1000`, aspect 3.8:1. Vendored at `core/portal/public/brand/ltm-coral.svg` and also inlined as a React component at `core/portal/src/components/brand/LtmLogo.tsx` so it can inherit `currentColor` for the monochrome variants. Rendered at **120px wide** in the expanded sidebar, and replaced by a **28px coral glyph mark** in the collapsed icon rail. **Never placed on a coral background.** On light backgrounds the full-colour asset is used as-is; on dark it is used as-is; no recolouring of the mark itself.
- **Product lockup:** `MCPForge` (heading face) with the kicker `BlueVerse ValueMesh` beneath it — exact casing, not all-caps, not "Blueverse". Sidebar footer is two lines and nothing else: `LTM · Oracle AI Practice` / `BlueVerse ValueMesh`.
- **The company is LTM.** Never LTIMindtree. `OraAIX`, `OraFORGE`, `OMF` are retired names and are lint-blocked in the portal source the same way they were QA-checked in the console.
- **Coral discipline — the 10% rule.** Coral carries roughly a tenth of the visual weight: active navigation, the primary action in a view (one per view), focus rings, the single number that matters on a card, and the brand lockup. **Never a background behind long text.** Long body copy is `--text-1`/`--text-2` on a neutral surface, in both themes. This rule survives into light mode unchanged and is the thing most likely to be violated by an autonomous build lane, so it is written into the component contract: `Button` has exactly one `variant="primary"` per view, enforced by a lint rule and by review.

### 4.2 Token architecture — three tiers

Tokens are layered so that a theme change touches one tier and a component change touches another.

```
Tier 1  PRIMITIVES     raw values, theme-independent      --ltm-coral-500: #F2665B
Tier 2  SEMANTIC       role in the UI, theme-dependent    --bg-surface, --text-1, --accent, --status-write
Tier 3  COMPONENT      per-component alias, rarely used   --chip-write-bg, --plan-card-border
```

**Rule: components may only reference Tier 2 and Tier 3. Never Tier 1, never a raw hex.** Tier 1 is the palette; Tier 2 is the design system; Tier 3 exists only where a component needs a value that is genuinely not a general role (roughly eight cases, all in the write-path family).

### 4.3 Tier 1 — the primitive palette

The canonical LTM palette, extended with the ramp steps that the accessibility bar actually requires. **Nothing here contradicts the established palette; the additions are lighter/darker steps of the same hues**, because the established palette is dark-native and several of its values fail contrast as *text* even in dark mode (measured in §4.6).

```css
/* --- Brand --------------------------------------------------------------- */
--ltm-coral-300: #F5877E;   /* dark-mode text on elevated surfaces */
--ltm-coral-500: #F2665B;   /* CANONICAL. From LTM_Coral.svg. The brand value. */
--ltm-coral-600: #D14A38;
--ltm-coral-700: #C93F2E;   /* canonical --coral-d. Light-mode solid fill. */
--ltm-coral-800: #B23A2C;   /* light-mode text/link colour */
--ltm-coral-tint-dark:  rgba(242,102,91,0.12);
--ltm-coral-tint-light: rgba(201,63,46,0.10);

/* --- Ink (dark-mode surfaces; also the light-mode text ramp) -------------- */
--ltm-ink-900: #1A1D21;   /* canonical --ink   */
--ltm-ink-800: #202327;   /* canonical --ink2  */
--ltm-ink-700: #262A2F;   /* canonical --ink3  */
--ltm-ink-600: #2C3036;   /* canonical --ink4  */
--ltm-ink-500: #34383D;   /* canonical --line  */
--ltm-ink-550: #2A2E33;   /* canonical --line-soft */

/* --- Neutrals ------------------------------------------------------------ */
--ltm-grey-100: #FFFFFF;
--ltm-grey-150: #FAFAFB;
--ltm-grey-200: #F4F5F7;
--ltm-grey-300: #E4E6EA;
--ltm-grey-400: #D6D9DE;
--ltm-grey-500: #A8ADB5;
--ltm-grey-600: #767B82;
--ltm-grey-650: #6B7076;   /* canonical --mute-d */
--ltm-grey-700: #54585F;
--ltm-grey-750: #9CA3AF;   /* canonical --mute (a dark-mode text value) */
--ltm-grey-800: #C7CDD6;   /* dark-mode secondary text */

/* --- Status hues: 3 steps each (dark text / core / light text) ------------ */
--ltm-blue-300:   #5FA8C6;  --ltm-blue-500:   #3E8FAF;  --ltm-blue-700:   #2A6A85;
--ltm-green-300:  #4FBF7B;  --ltm-green-500:  #2E9B57;  --ltm-green-700:  #1F7A42;
--ltm-amber-300:  #E0A040;  --ltm-amber-500:  #C87F16;  --ltm-amber-700:  #9A6110;
--ltm-purple-300: #A78BFA;  --ltm-purple-500: #6D3AAE;  --ltm-purple-700: #4B2178;
```

`--ltm-blue-500`, `--ltm-green-500`, `--ltm-amber-500`, `--ltm-purple-700` (`#4B2178`) and `--ltm-purple-300` (`#A78BFA`) are the exact canonical values from the concept palette. The `-300` and `-700` steps are new and exist for one reason: **contrast on text**, proven in §4.6.

**Forbidden values, lint-blocked:** `#FA5843`, `#4FC3F7`, `#B388FF`, `#4ADE9B`. These are the superseded scheme and must never reappear.

### 4.4 Tier 2 — semantic tokens, both themes

This is the table the build lane implements. Light is the `:root` default; dark is applied under `[data-theme="dark"]` and under `prefers-color-scheme: dark` when no explicit choice is stamped (§13.2).

#### Surfaces and text

| Semantic token | Light | Dark | Notes |
|---|---|---|---|
| `--bg-canvas` | `--ltm-grey-200` `#F4F5F7` | `--ltm-ink-900` `#1A1D21` | The page behind everything |
| `--bg-surface` | `--ltm-grey-100` `#FFFFFF` | `--ltm-ink-800` `#202327` | Cards, panels, table body |
| `--bg-surface-2` | `--ltm-grey-150` `#FAFAFB` | `--ltm-ink-700` `#262A2F` | Nested cards, table headers, code blocks |
| `--bg-surface-3` | `--ltm-grey-200` `#F4F5F7` | `--ltm-ink-600` `#2C3036` | Hover, selected rows, inline chips |
| `--bg-sidebar` | `--ltm-grey-100` `#FFFFFF` | `--ltm-ink-900` `#1A1D21` | Sidebar keeps a hairline border in light, none in dark |
| `--bg-inset` | `#EDEFF2` | `#16191C` | Wells: YAML viewers, diff gutters, terminal output |
| `--text-1` | `--ltm-ink-900` `#1A1D21` | `--ltm-grey-100` `#FFFFFF` | Primary body and headings |
| `--text-2` | `--ltm-grey-700` `#54585F` | `--ltm-grey-800` `#C7CDD6` | Secondary body, table cell support text |
| `--text-3` | `--ltm-grey-600` `#767B82` | `--ltm-grey-750` `#9CA3AF` | Labels, metadata, timestamps. **Minimum text tier.** |
| `--text-disabled` | `--ltm-grey-500` `#A8ADB5` | `--ltm-grey-650` `#6B7076` | Disabled controls only. **Never used for readable content.** |
| `--line` | `--ltm-grey-400` `#D6D9DE` | `--ltm-ink-500` `#34383D` | Standard borders |
| `--line-soft` | `--ltm-grey-300` `#E4E6EA` | `--ltm-ink-550` `#2A2E33` | Dividers inside a surface |
| `--line-strong` | `#B9BEC6` | `#454A51` | Focused/selected container borders, table outer rule |

> **The single most important light-mode decision:** light mode is **not** an inversion. The dark theme is built on a warm-neutral near-black ink ramp with white type; the light theme is built on a **cool-neutral grey canvas with white cards** — canvas darker than surface, so cards read as raised without shadow, which is what keeps a dense grid legible when it is printed or projected. Inverting the dark theme would give white canvas with grey cards, and every table would lose its edge.

#### Brand and interaction

| Semantic token | Light | Dark | Contrast proof |
|---|---|---|---|
| `--accent` | `--ltm-coral-800` `#B23A2C` | `--ltm-coral-500` `#F2665B` | Text/link/active-nav colour. 5.94:1 on white; 5.50:1 on ink-900 |
| `--accent-solid-bg` | `--ltm-coral-700` `#C93F2E` | `--ltm-coral-500` `#F2665B` | Primary button fill |
| `--accent-solid-fg` | `#FFFFFF` | `--ltm-ink-900` `#1A1D21` | 4.96:1 light; 5.50:1 dark — **both pass AA** |
| `--accent-tint` | `rgba(201,63,46,0.10)` | `rgba(242,102,91,0.12)` | Active-nav wash, selected-row wash |
| `--accent-border` | `rgba(201,63,46,0.40)` | `rgba(242,102,91,0.40)` | Emphasised card borders |
| `--focus-ring` | `--ltm-coral-700` `#C93F2E` | `--ltm-coral-500` `#F2665B` | 2px solid + 2px offset, always |

Note the dark-mode primary button: **coral fill with near-black ink text**, not white text. White on `#F2665B` is 3.08:1 and fails. Ink on coral is 5.50:1 and passes. This is a real, easy-to-get-wrong detail and it is why `--accent-solid-fg` exists as a token rather than being hard-coded to white.

#### Status semantics — the meaning map

The concept palette already assigns meaning to four hues. That mapping is preserved exactly and extended to the states the real app has.

| Semantic token | Meaning | Light (text) | Dark (text) | Used by |
|---|---|---|---|---|
| `--status-read` | Read / analytical / informational | `--ltm-blue-700` `#2A6A85` | `--ltm-blue-300` `#5FA8C6` | read verbs, `rest` binding chip, analytical archetype, "plan" phase |
| `--status-ok` | Active · certified · resolved · merged | `--ltm-green-700` `#1F7A42` | `--ltm-green-300` `#4FBF7B` | probe `resolved`, PR `merged`, execute `ok`, `wrapped-vendor` chip |
| `--status-write` | Write · gate · needs care · pending | `--ltm-amber-700` `#9A6110` | `--ltm-amber-300` `#E0A040` | write verbs, `plsql` chip, awaiting approval, `degraded_readonly`, guardrail warnings |
| `--status-platform` | Platform / structural / slice | `--ltm-purple-700` `#4B2178` | `--ltm-purple-300` `#A78BFA` | `database` chip, package/slice chips, platform archetype |
| `--status-neutral` | Unclassified / draft / function binding | `--text-3` | `--text-3` | `function` chip, draft state |
| `--status-danger` | Refusal · disabled · irreversible · SoD conflict | `--ltm-coral-800` `#B23A2C` | `--ltm-coral-500` `#F2665B` | policy denials, `disabled_*` probe statuses, irreversible reversal class |

**Judgment call, stated plainly:** `--status-danger` is an **alias of the coral ramp**, not a new red hue. Introducing a second red next to `#F2665B` would produce two nearly-identical reds with different meanings, which is worse than reusing one. Danger is therefore distinguished from brand-accent by **treatment, not hue**: danger always appears as a filled or outlined *chip or banner with a word and a glyph*, never as a bare accent-coloured link or button; and the brand accent never appears as a chip. If the user wants a genuinely distinct danger hue later, it is a one-line change to `--status-danger` because nothing references coral directly. See §14.

Each status also has a `-bg` and `-border` companion (tint at 12–14% in dark, 8–10% in light) for chips, and a `-strong` variant for filled banners. Full set generated mechanically in the token file; the six above are the ones that carry meaning.

### 4.5 Typography

The concept console used `Cambria/Georgia` for headings and `Calibri/Arial` for body, chosen because it had to be an Office-safe self-contained HTML file. **The real portal is a web application and does not have that constraint** — but the serif/sans pairing is genuinely part of the LTM look and is kept, narrowed to where it earns its place.

| Role | Stack | Where |
|---|---|---|
| **Display / brand** | `Cambria, Georgia, 'Times New Roman', serif` | The product lockup, page titles (H1), the one big number on a KPI tile, section titles. Nothing else. |
| **UI / body** | `Inter, 'Segoe UI', system-ui, -apple-system, Calibri, Arial, sans-serif` | Everything else. Self-hosted Inter (`next/font/local`, variable, subset latin) so there is no external font request and no CLS. Falls back to Segoe UI on Windows, which is where this will mostly run. |
| **Mono / data** | `'JetBrains Mono', 'Cascadia Mono', Consolas, ui-monospace, monospace` | Tool ids, YAML, JSON, diffs, hashes, correlation ids, business keys, amounts in tables. |

**Amounts, ids, hashes and business keys are always mono with tabular figures** (`font-variant-numeric: tabular-nums`). In a console where the difference between `18,400.00` and `184,000.00` is the whole point, proportional digits in a right-aligned column are a defect.

Scale (rem-based, 16px root, so browser zoom and user font-size settings work — §12):

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `--font-display-lg` | 28px / 1.25 | 700 serif | Page H1 |
| `--font-display-md` | 21px / 1.3 | 700 serif | Card H2, the KPI number |
| `--font-display-sm` | 16px / 1.35 | 700 serif | Section title |
| `--font-body-lg` | 15px / 1.6 | 400 | Long prose (plan sentences, remediation text) |
| `--font-body` | 13.5px / 1.55 | 400 | Default UI text |
| `--font-body-sm` | 12.5px / 1.5 | 400 | Table cells, drawer detail |
| `--font-label` | 11px / 1.4 | 600, `.5px` tracking, uppercase | Field labels, table headers, eyebrows |
| `--font-chip` | 10.5px / 1 | 700, `.4px` tracking | Status chips, binding chips |
| `--font-mono` | 12.5px / 1.5 | 400 | Code, ids, YAML |
| `--font-mono-sm` | 11.5px / 1.45 | 400 | Inline hashes, dense table mono cells |

**Minimum text size is 11px and it is reserved for chips and labels only.** No prose below 12.5px. Note `--font-chip` at 10.5px is a chip whose accessible name is on the element — it is a label, not content (§12.5).

### 4.6 Contrast proof — the measured table

Measured with the WCAG 2.1 relative-luminance formula. **Bold values are the ones that fail and therefore drove a token decision.**

**Dark theme, foreground on `--bg-surface-2` `#262A2F`** (the worst realistic card surface):

| Value | Ratio | Verdict |
|---|---|---|
| `#FFFFFF` text-1 | 14.44 | pass |
| `#C7CDD6` text-2 | ~9.6 | pass |
| `#9CA3AF` text-3 | 5.69 | pass |
| `#6B7076` text-disabled | **2.89** | fails — **disabled only, never content** |
| `#F2665B` coral-500 | 4.69 | pass (AA normal) |
| `#3E8FAF` blue-500 | **3.95** | **fails as text** → dark text token is `#5FA8C6` (5.43) |
| `#2E9B57` green-500 | **4.09** | **fails as text** → dark text token is `#4FBF7B` (6.24) |
| `#C87F16` amber-500 | 4.47 | **marginal fail** → dark text token is `#E0A040` (6.37) |
| `#A78BFA` purple-300 | 5.30 | pass |

This is the concrete reason the `-300` steps exist. The canonical `-500` status values stay in the system as **fills, borders and chart marks** — where the 3:1 non-text threshold applies and they pass comfortably — but they are not text colours in dark mode. The concept console got away with it because its status colours mostly appeared as chip borders and large numerals; a dense data grid does not get away with it.

**Light theme, foreground on `--bg-surface` `#FFFFFF`:**

| Value | Ratio | Verdict |
|---|---|---|
| `#1A1D21` text-1 | 16.91 | pass |
| `#54585F` text-2 | 7.15 | pass |
| `#767B82` text-3 | 4.26 | **marginal** — capped at ≥12.5px, and on `--bg-surface` only (never on `--bg-surface-3`) |
| `#F2665B` coral-500 | **3.08** | **fails as text** → light text token is `#B23A2C` (5.94) |
| `#C93F2E` coral-700 as fill, white text | 4.96 | pass — the primary button |
| `#2A6A85` blue-700 | 6.00 | pass |
| `#1F7A42` green-700 | 5.36 | pass |
| `#9A6110` amber-700 | 5.13 | pass |
| `#4B2178` purple-700 | 11.75 | pass |

`--text-3` at 4.26:1 is the one value in the system that is below 4.5. **Decision: raise it to `#6E7379` (4.53:1) rather than ship a known-marginal token.** Recorded here because the number matters: the token file in §13 carries `#6E7379`, not `#767B82`, for light `--text-3`; `#767B82` remains a primitive used for icons and borders where the 3:1 threshold applies.

**Non-text contrast (3:1, WCAG 1.4.11)** — borders, focus rings, chart marks, chip outlines, and the disabled-state boundary are all checked at 3:1 against their own background, not against the canvas. The `--line` tokens at 1.25–1.4:1 are *decorative dividers* and are permitted below 3:1 only where the component's boundary is also conveyed by a background change; any control whose only boundary is a border (input fields, unfilled buttons, checkbox outlines) uses `--line-strong` and is checked at 3:1.

### 4.7 Spacing, radius, elevation, motion

**Spacing** — 4px base, exposed as `--space-1` … `--space-12` (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96). Two density modes, because a dense console genuinely needs both:

| | `comfortable` (default) | `compact` |
|---|---|---|
| Table row height | 40px | 32px |
| Card padding | `--space-5` (20px) | `--space-4` (16px) |
| Control height | 34px | 28px |

Density is a **user preference persisted per browser**, toggled in the topbar, implemented as `data-density` on `<html>` driving three tokens. It is not a per-page decision.

**Radius** — `--radius-sm: 6px`, `--radius: 10px` (canonical), `--radius-lg: 14px`, `--radius-pill: 999px`. Chips are pill; cards, inputs and buttons are `--radius`; modals and drawers are `--radius-lg`; nothing is square except table cells and code wells.

**Elevation** — dark mode elevates with **surface lightness**, light mode with **shadow**. This is the second place the two themes genuinely differ in mechanism rather than value:

| Token | Light | Dark |
|---|---|---|
| `--elev-0` | flat on `--bg-surface` | flat on `--bg-surface` |
| `--elev-1` | `0 1px 2px rgba(26,29,33,.06), 0 1px 1px rgba(26,29,33,.04)` | step to `--bg-surface-2`, `1px` `--line-soft` border |
| `--elev-2` (popover, dropdown) | `0 4px 12px rgba(26,29,33,.10)` | step to `--bg-surface-3` + `0 4px 12px rgba(0,0,0,.45)` |
| `--elev-3` (drawer, modal) | `0 16px 40px rgba(26,29,33,.16)` | `0 16px 40px rgba(0,0,0,.6)` + `--line-strong` border |
| `--scrim` | `rgba(26,29,33,.40)` | `rgba(0,0,0,.60)` |

**Motion** — `--motion-fast: 120ms`, `--motion: 220ms`, `--motion-slow: 320ms`, easing `cubic-bezier(.2,.8,.2,1)`. Drawers slide, accordions and disclosure animate height, everything else cross-fades. **All of it is gated behind `@media (prefers-reduced-motion: reduce)`, which collapses every duration to `1ms`** — one media block, no per-component handling. The one animation that never runs is anything on the plan/confirm sequence: state changes in the write path are instant and explicit, because an animated transition between "plan" and "executed" is a lie about what happened when.

---

## 5. Information architecture

### 5.1 What changed from the concept console, and why

The concept console had 11 pages in three groups: THE CONCEPT (Overview, Why this / why now, Architecture), THE PLATFORM (Registry, Developer Workspace, Business Intake, Governance & Approvals, Consumption Graph, Application Enablement), THE CASE (Live Walkthrough, Plan & Decisions). That structure was **an argument with a beginning, a middle and an end** — correct for a twenty-minute demo, wrong for a working day.

Four structural changes:

1. **The narrative pages are removed.** Overview, Why this / why now, Live Walkthrough, and Plan & Decisions do not appear in the working portal. Their content belongs to the deck and the exec materials. Architecture survives as **documentation, not navigation** — served at `/docs/architecture` and linked from the places where its concepts appear (the binding-type explainer in the tool drawer, the slice explainer in Packages), never as a sidebar destination someone has to walk past every day. This buys back the top-level slots the real app needs.
2. **Governance & Approvals splits in two.** In the concept it was one page because it was one argument. In the real app, an **approval queue is a place you live** and **governance configuration is a place you visit**. They have different personas, different rhythms, and different urgency. Approvals gets its own top-level entry with a live count badge.
3. **Two surfaces are added that the concept had no reason to have:** **Changes** (the git-PR working set, because the write model demands it) and **Insights** (the benchmark metrics, because Phase 1 made TTFC/VTC/DH/SA@1/MTB into CI gates and a gate nobody can see is a gate nobody defends). Changes is not a nav item — see §5.3.
4. **The grouping changes from narrative arc to working mode.** WORK (things you author), CONTROL (things you govern), PLATFORM (things you operate). The three-collapsible-group sidebar behaviour is kept exactly as specified for the console: only the group containing the current page is expanded on load, navigating into a collapsed group auto-expands it, and the whole sidebar collapses to a ~56px icon rail with tooltips.

### 5.2 The nav

```
WORK        Home              /
            Catalog           /catalog        (+ /catalog/[toolId], /catalog/servers/[serverId])
            Build             /build          (+ /build/[draftId])
            Requests          /requests       (+ /requests/[requestId])

CONTROL     Approvals   [n]   /approvals      (+ /approvals/[approvalId])
            Governance        /governance     (roles · policy · security posture · kill switch)
            Activity          /activity       (+ /activity/calls/[callId], /activity/consumption)

PLATFORM    Environments      /environments   (+ /environments/enablement, /environments/packages)
            Insights          /insights
```

> **EXTENDED by §16 — Phase 5, 27 Aug 2026. The nine destinations are unchanged** — §14 item 5's defence of the count stands. Phase 5 adds a fifth **Governance** tab (`Consumers`) and a second **Activity** view (`/activity/consumers`), on the rule that Governance is where a consumer's authorization is decided and Activity is where its behaviour is observed.

Nine destinations. Rail icons must be distinct — the concept console already hit this bug (Architecture and Application Enablement both wanted "A"). Assigned once, centrally, in `NAV`: Home `⌂`, Catalog `▤`, Build `⚒`, Requests `✎`, Approvals `✓`, Governance `⚖`, Activity `∿`, Environments `⬡`, Insights `▲`. Use a real icon set (`lucide-react`, which ships with shadcn) rather than glyph characters; the letters above are just the disambiguation record.

**Global chrome, present on every page:**

- **Topbar left:** page title + subtitle (kept from the console — it works).
- **Topbar centre:** the **command palette trigger** (`⌘K` / `Ctrl+K`), rendered as a wide search affordance, not a small icon. This is the fast-discovery surface (§9) and its prominence is a product decision, not a layout accident.
- **Topbar right:** **environment chip** (§11) · **branch / change-set chip** (§8.4) · persona pill · density toggle · theme toggle · account.
- **Change tray:** a persistent, collapsed-by-default rail at the bottom-right showing the user's uncommitted working set (§8.3). Zero state = hidden entirely.

### 5.3 Page specs

Each entry states: who it is for, what it reads from, and what it must contain. "**git**" means definitional data read from the repo/PR host; "**gw**" means runtime data read from the gateway API over the runtime datastore.

---

#### Home — `/`
*All personas · reads gw + git · a worklist, not a dashboard.*

Role-aware, three-column. It is the answer to "what needs me today," and it must be honest enough that a person who opens nothing else has still not missed anything.

- **My queue** — approvals awaiting me (runtime write approvals and definitional PR reviews, in one list, differentiated by chip), my open drafts, my PRs with changes requested, my requests awaiting verdict.
- **What broke** — probe regressions since the last run, tools that moved to a `disabled_*` status, guardrail refusals in the last 24h, any hash-chain break reported by `forge audit verify`.
- **What changed** — recently merged manifests, newly resolved tools, role scope changes. Each with a link to the PR that caused it.
- One KPI strip, four numbers maximum, serif display face: tools resolved / total · approvals open · writes executed (7d) · reversals (7d). **No charts on Home.** Charts live in Insights.

Empty state matters here and is easy to get wrong: on a fresh local Wave 0 install, Home is nearly empty. The empty state must say *"Nothing is waiting on you"* plus the three things a new user should do first (run the probe, open the catalog, read the architecture doc) — not a blank grid.

---

#### Catalog — `/catalog`
*All personas, primary surface for developer and business user · reads git (definitions) + gw (probe status, call volume).*

The Registry, evolved. This is the highest-traffic page in the product and gets the most design attention.

**Layout:** left facet column (collapsible, remembered), main results area with a **view toggle: Table ⇄ Cards ⇄ Map**. Table is the default for the real portal (the concept defaulted to cards; cards are the demo view, table is the working view).

**Facets** — every one of these is a real manifest or probe field, and every one is also a `forge.find` parameter, which is the point (§9.4):

| Facet | Source | Control |
|---|---|---|
| Free text | index | search input, debounced, backed by the same BM25 index as `forge.find` |
| Application | `app` | multi-select list with counts |
| Module / server | `server` | dependent multi-select |
| Archetype | `archetype` | pill row (transactional / analytical / platform / wrapped) |
| **Binding type** | `binding.type` | **pill row with the five binding chips** — REST · DB/SQL · PL/SQL · Function · Wrapped |
| **Deployment package (slice)** | derived `packages` | **select, defaulting to the deployed package**, with "All in repo" as an explicit option |
| Verb | `verb` | multi-select from the closed 17-verb list, grouped Read / Write |
| Write | `write` | tri-state toggle: any / read-only / write |
| Sensitivity | `sensitivity` | multi-select (public/internal/confidential/financial/personal) |
| Process tag | `processTags` | multi-select (P2P, R2R, O2C…) |
| Role | compiled `roles/*.scope.json` | select — "tools granted by role X" |
| **Probe status** | `probe-report.json` | multi-select over the closed enum, `resolved` and `degraded_readonly` preselected |
| Change state | git | draft / in review / merged — see §8 |

Live count line under the facets, exactly as the console did it: `47 of 150 tools · JD Edwards Financials`. Facet state is URL-encoded so a filtered catalog is a shareable link — this is how a steward sends a colleague "the six write tools in this slice."

**Binding type gets real UI weight, not a badge.** Per the concept spec it is a first-class manifest property that decides the security handshake. In the real portal it appears in five places: the facet row, a chip on every row/card, a dedicated **"Binding & handshake"** section in the tool detail, a column in the Governance security-posture table, and a required selector in Build. The five chip treatments carry forward the console's colour assignments (REST = read/blue, DB/SQL = platform/purple, PL/SQL = write/amber, Function = neutral, Wrapped = ok/green) with the accessible-name and glyph requirements of §12.5.

**Slice / package gets equal weight.** Package chips appear on server rows; selecting a package narrows the whole catalog and renders the **slice manifest panel** — what ships, how many servers/tools/apps/roles/waves, which binding types are present, what is *not* included, and the standing note that commercial packaging is undecided. That note is required while D1 is open (Phase 2 §8.1 item 5).

**Tool detail** — a **route** (`/catalog/[toolId]`), rendered as a drawer over the catalog when navigated to from a list, and as a full page when opened directly. This is important: the concept's drawer was drawer-only and therefore unlinkable. Content, in order:

1. Header: title, tool id (mono, click-to-copy), verb chip, write chip, archetype badge, **binding chip**, sensitivity chip, **probe status chip**, package chips, change-state chip.
2. **Action bar:** `Run` (opens the write path, §7) · `Describe` (shows the agent-facing payload, §10.4) · `Propose change` (branches the manifest into Build) · `Add to activation set`.
3. Purpose, aliases, and **disambiguation** — rendered prominently, with the named sibling tools as links, because §5.5 of Phase 2 makes this the mechanism that stops near-miss failures.
4. Manifest YAML, syntax-highlighted, read-only, with a "view on git" link and the manifest sha.
5. **Binding & handshake** — binding type, what it actually calls, the handshake pattern, whether identity carries natively, the default review path, the underlying object and technology. Identity carriage renders in three visually distinct states: `verified` (probe-written, green, with the probe run timestamp), `declared/unverified` (amber, with "not yet verified by probe"), `no` (with the compensating control named). **The UI never shows `verified` without a probe reference.**
6. Inputs table, output shape with row cap, result keys.
7. **Write safety** (write tools only) — dry-run strategy, confirm TTL, guardrails as a readable list, the reversal contract with its class and window, whether human approval is required. This section is the human-readable form of the manifest's `writeSafety` block and it is what an approver reads before approving the *tool*.
8. Error catalogue — condition → what the agent is told → `next` action. Table form.
9. Eval intents and last benchmark result for this tool.
10. **Consumption** — which agents/platforms called it, 30-day volume, last call, link into Activity.

---

#### Build — `/build`
*Developer · reads/writes git · this is where "Save means PR" is most load-bearing.*

The Developer Workspace, evolved from an authoring demo into a real editor.

- **Draft list** — my drafts, their validation state, their PR state. A draft is a branch.
- **Editor** (`/build/[draftId]`): three-pane. Left = the manifest YAML in CodeMirror with schema completion and inline `forge validate` diagnostics. Centre = **live preview** of what this manifest produces: the tool card (with its measured token count against the ≤60 budget), the resident definition (against ≤400), the describe payload (against ≤600), and the generated JSON Schema. Right = **checks**: validate rules, codegen diff, contract-test results, token budget, role budget impact, SoD implications.
- **Guided authoring** for people who do not want to write YAML: a form (binding type required, per the concept spec) that writes the same YAML, with the YAML always visible. The form is a view over the manifest, never a separate representation.
- **Binding-type selection drives the form**, exactly as specified for the console: it selects the security-handshake template shown, the sandbox harness described, and the review path — with `plsql` and `function` structurally unable to select expedited review, and the reason stated in an amber note rather than a disabled control with no explanation.
- **Sandbox run** — execute against the mock target using the binding's declared harness. For a write tool this exercises the full plan/confirm path (§7) against mocks, which is how a developer sees their `planTemplate` rendered as a human would read it *before* it reaches a reviewer.
- **Propose** — the terminal action. Opens or updates a PR, shows the compiled diffs (manifest, generated artefacts, role scope), and hands off to Changes.

---

#### Requests — `/requests`
*Business user · reads gw + git.*

Business Intake, evolved from a demo verdict box into a tracked request lifecycle.

- **Ask** — a plain-English box. Behind it is the same `forge.find` index the agents use, so the human and the agent get the same answer to the same question. That symmetry is worth stating in the UI: "this is the same search your agents use."
- **Three-tier verdict**, carried forward: **exists** (here it is, here is how to get access) · **near miss** (here are the closest, here is what would need to change — with the similarity score shown, not hidden) · **new** (a drafted proposal, pre-filled into a Build draft).
- **The six intake questions** as a structured form on the "new" path, because the answers become manifest fields (owner, steward, sensitivity, process tag, expected volume, write or read).
- **My requests** — a tracked list with states: `submitted → triaged → drafted → in review → merged → enabled`. The final state is `enabled`, not `merged`, because a merged manifest whose probe says `disabled_missing_binding` is not a delivered capability. This is the surface where the business user finds out that their capability is waiting on their own application team, and it names that team.

---

#### Approvals — `/approvals`
*Admin / approver · reads gw (runtime) + git (definitional) · the queue you live in.*

**Two kinds of approval in one queue, differentiated but not separated:**

| | **Runtime approval** | **Definitional approval** |
|---|---|---|
| What | A write call whose tool has `humanApprovalRequired: true` is waiting for a named approver before a confirm token is minted | A PR changing a manifest, a role, or a package |
| Urgency | Minutes. An agent and a human are blocked right now. | Hours to days. |
| Backed by | gw · `audit_approval` | git · PR |
| Expires | Yes — the plan has a TTL | No |

The queue is one list with a hard visual separation by urgency: expiring runtime approvals pin to the top with a live countdown. Filters: kind, application, requester, tool, sensitivity, age. Bulk actions are available for definitional approvals and **structurally unavailable for runtime write approvals** — approving six live financial writes with one checkbox is exactly the affordance this product must not have.

> **EXTENDED by §16.4 — Phase 5.** Consumer registrations, credential rotations and standing-authorization grants are **definitional** approvals and need no new UI — they are change proposals, and the queue already holds those.

Runtime approval detail is specified in §7.4.

---

#### Governance — `/governance`
*Admin · reads git + gw · four tabs.*

1. **Roles** — the role editor. Per Phase 2 §8.1 item 4, a role editor that hides which tools a glob picks up is the failure this architecture exists to prevent. So: edit the globs on the left, and the **compiled scope** renders live on the right as an explicit tool-id list, with added/removed tools diffed against the currently merged scope. Below it: the **role token budget meter** (resident set vs the 1,300 budget, with the tools to demote named when over), and the **SoD panel** showing declared conflicts and implicit `create`/`approve` pairs on the same entity, each with its disposition. None of this can be saved directly — it produces a PR whose diff *is* the compiled `roles/*.scope.json`.
2. **Policy & guardrails** — the guardrails declared across the catalogue, in one table: kind, field, threshold, message, which tools carry it. Read-only view over the manifests, with a "propose change" that routes to Build. Plus deployment-level caps from the overlay (row caps, rate limits, concurrency) shown as values with their compiled-in hard ceilings beside them, so it is visible that a customer can tighten but not loosen.
3. **Security posture** — the native-security table from the concept console, made live: one row per application, with **binding types in play** (chips, computed from the deployed catalogue), **identity carried** (from the probe, not from the manifest), and what actually enforces access. The OIC service-account exception stays a highlighted row. The standing caption stays: only REST/OAuth and per-user-token rows carry identity by themselves.
4. **Kill switch** — the four granularities (tool · module server · binding type · whole deployment), current flags with their reason text and expiry, and the action to set one. Setting a deployment-wide kill is a type-to-confirm action (§7.6). Every kill and un-kill writes an audit record and is shown with its author.

> **EXTENDED by §16.2 — Phase 5, 27 Aug 2026.** A fifth tab, **Consumers**, follows tab 1's pattern exactly: edit on the left, the compiled authorization artefact rendered explicitly on the right, and nothing saves directly.

---

#### Activity — `/activity`
*Admin, developer, and business user (scoped to their own calls) · reads gw.*

Audit and consumption, which the concept console had as two separate ideas and which are one dataset.

- **Calls** — the run explorer over `audit_call`. Virtualised table. Columns: time, caller, tool, verb/write chip, phase (`plan`/`execute`/`reject`/`reverse`), outcome, target env, latency, result keys, reversal state. Filters cover the three queries Phase 2 §4.6 designed the shape to answer in one hop, and each is a **saved view shipped with the product**, not something a user has to construct:
  - *"Everything this person did in this system this week"*
  - *"Who created document 12345, through which tool, under whose approval, and has it been reversed?"* — a **business-key search box**, first-class, at the top of the page. This is the query that gets asked under pressure and it should be one field, not four filters.
  - *"Every write that was planned and never confirmed"* — the **abandoned-intent view**, which is genuinely useful for spotting an agent proposing things humans keep declining.
- **Call detail** (`/activity/calls/[callId]`) — the full record rendered legibly: the plan text as it was shown, the args (redacted per sensitivity, with redacted values shown as their `sha256[:12]` so equality is still reasonable about), the confirm-token binding, the approval record if any, the identity-honesty block (`identity_carrying`, `target_identity_observed`, `identity_match`, `compensating_control`), the result keys, the reversal state, and the hash-chain position. **The reversal action lives here** (§7.5).
- **Consumption** (`/activity/consumption`) — tool → agent → platform → scope, with 30-day volume. Graph view via @xyflow/react and an equivalent table view. This is also where G9's retirement signal lives: tools with zero calls over a window, flagged for a retirement conversation.
  > **EXTENDED by §16.3 — Phase 5, 27 Aug 2026.** Consumption's 'consuming agent' is now the authenticated `consumer_id`; before Phase 5 it had no source. A sibling view `/activity/consumers` carries per-consumer usage, quota headroom and anomaly events.
- **Integrity** — the result of `forge audit verify`: chain intact, or the first break with its row. Small, but it must be visible somewhere, and this is where.

---

#### Environments — `/environments`
*Admin · reads gw + git · three tabs.*

1. **This deployment** — what §11 describes: environment class, gateway version, bundle version, deployed package, catalogue artefact digest, datastore kind and location, git remote (or "local git only"), identity provider in use, last probe run, kill flags in force. One screen that answers "what am I actually looking at."
2. **Enablement** (`/environments/enablement`) — the concept console's Application Enablement page, made real by `probe-report.json`. Per application: the 70/30 framing, the capability-probe results, and the **enablement backlog** — every tool not `resolved`, with its failing check, its `remediation` text, and its `owningTeam`. Grouped by owning team, because that is how the work actually gets assigned. The per-application accordion (route, gate, steps, owners, bindings, gotcha) carries forward from the console; the probe numbers replace the illustrative ones.
3. **Packages** (`/environments/packages`) — the slice surface. Each package: its named module servers, its derived counts, the binding types present, the process roles that span it, what is not included, and the `slice-diff-proof` CI result showing that this slice is the same core as every other. **The standing note that commercial packaging is undecided appears here verbatim while D1 is open.**

---

#### Insights — `/insights`
*Admin, developer · reads gw + CI artefacts.*

The metric surface Phase 1 asked for and Phase 2 §8.1 item 6 required. Five metric cards — **TTFC, VTC, DH, SA@1, MTB** — each with its target, its current value, its trend across waves, and a pass/fail state against the CI gate. Plus:

- **Per-role TTFC breakdown**, which §5.10 of Phase 2 made the number that actually matters.
- **The scaling invariant chart** — TTFC for unrelated roles across wave boundaries, with the 5% band drawn. A wave that breaks the invariant should be visible as a line leaving a band, not as a number in a table.
- **Token budget pressure** — tools near their card/definition/describe ceilings, roles near the 1,300 budget. This is the early warning that stops the budget gate from failing a build by surprise.
- **Benchmark detail** — the failing cases from the last run, including which near-miss pair was confused and which negative was answered with a tool. A failing SA@1 number is useless; the six intents that failed are actionable.

---

## 6. The change model — making "Save means pull request" visible

This is the cross-cutting mechanic that touches every editing surface, and the one most likely to be built wrong.

### 6.1 The state machine

```
   ┌─ local edit ──┐
   │               v
 (none) ──────> DRAFT ──> VALIDATING ──> IN REVIEW ──> APPROVED ──> MERGED ──> DEPLOYED
                  │            │             │  ^                                  │
                  │            │             │  └── CHANGES REQUESTED ◄────────────┘
                  │            v             v                                     v
                  └──────> INVALID       WITHDRAWN                            probe status
```

| State | Means | Where it lives | Chip |
|---|---|---|---|
| `DRAFT` | Committed to a working branch, no PR | git branch | neutral, outline |
| `VALIDATING` | CI running `forge validate` / `codegen` / budgets | CI | neutral, animated dot (static under reduced motion) |
| `INVALID` | A validate rule or budget gate failed | CI | danger, with the rule name |
| `IN REVIEW` | PR open | PR host | `--status-write` (amber) |
| `CHANGES REQUESTED` | Reviewer asked for changes | PR host | `--status-write`, with reviewer name |
| `APPROVED` | Approved, not yet merged | PR host | `--status-ok`, outline |
| `MERGED` | In the main branch | git | `--status-ok`, filled |
| `DEPLOYED` | In the running catalogue artefact | gw | `--status-ok` + the probe status chip beside it |

**`MERGED` and `DEPLOYED` are different states and the UI must never conflate them.** A merged manifest that has not been deployed, or that deployed and probed `disabled_missing_binding`, is not a working tool. Conflating them is how a business user is told their capability is ready when it is not.

### 6.2 Save semantics — the vocabulary, fixed

Three words, used consistently everywhere, never substituted:

- **Save draft** — commits to the working branch. Reversible, private, cheap. This is what a Ctrl+S does.
- **Propose** — opens or updates the PR. This is the only action that puts work in front of another human. Never labelled "Save," "Submit," or "Publish."
- **Discard** — deletes the branch, with a confirm.

Any button in the product labelled "Save" that opens a PR is a defect. This goes in the component contract: `Button` has no `label="Save"` on a git-backed form; the `ProposeButton` component is the only path to a PR and it always shows the diff first.

### 6.3 The change tray

A persistent, collapsible rail at the bottom-right showing the current user's open working set: drafts, their validation state, and their PR state. Collapsed to a single pill (`3 changes`) by default; hidden entirely at zero. Expanding shows the list with per-item actions, and one **"Propose all"** that batches related edits into a single PR — because a role change and the tool change that motivated it belong in one review, and forcing two PRs makes reviewers see half a decision each.

### 6.4 The branch chip

In the topbar, beside the environment chip: the branch or change-set the portal is currently *reading* definitional data from. Default `main`. When a user is viewing a draft, the whole definitional surface (Catalog, Governance/Roles, Packages) can be **previewed on that branch** — with the chip switching to the branch name and taking an unmistakable outline treatment. This is how a reviewer answers "what does the catalog look like if I merge this?" without merging it. Runtime data (Activity, Approvals, probe) never changes with the branch and the UI says so when the branch chip is not `main`.

### 6.5 Diffs

Three diffs, always shown together on a Propose, because they are three different questions:

1. **Manifest diff** — what a human wrote.
2. **Generated diff** — what codegen produced. Collapsed by default, but present, because `generated/` is committed (Phase 2 §9 item 3) and reviewable blast radius is the whole reason.
3. **Compiled role scope diff** — which grants changed. **Never collapsed.** A tool addition that silently widens a role shows up here and nowhere else, and this is the diff a governance reviewer is actually reviewing.

---

## 7. The write path: plan → confirm → approve → execute → reverse

This is Wave 0's spine (Phase 1 §10.5 item 7 names it as Phase 3's obligation) and the product's most consequential interaction. It is a **component family**, not a page: the same sequence renders in the Catalog run panel, in the Build sandbox, in the Approvals queue, and in Activity.

### 7.1 The state machine

```
                                     ┌──────────────► PLAN_EXPIRED ──┐
                                     │  (TTL elapsed)                │
 IDLE ──► PLANNING ──► PLAN_READY ───┼──────────────► ARGS_CHANGED ──┼──► (re-plan)
   ▲                       │         │  (any input edited)           │
   │                       │         └──────────────► REFUSED ───────┘
   │                       │            (guardrail / SoD / scope)
   │                       │
   │                       ├── humanApprovalRequired ──► AWAITING_APPROVAL ──► APPROVED ──┐
   │                       │                                     │                        │
   │                       │                                     └──► DECLINED            │
   │                       │                                                              │
   │                       └──────────────────────── confirm ─────────────────────────────┤
   │                                                                                      v
   │                                                                                  EXECUTING
   │                                                                                      │
   │                            ┌────────────── REPLAYED (idempotent) ◄───────────────────┤
   │                            │                                                         │
   └──── new plan ────── DONE ◄─┴──────────────────────────────────────────────► FAILED ──┘
                          │
                          └──► REVERSING ──► REVERSED
```

Every one of those states has a distinct visual treatment. **None of them is a spinner with no text.**

### 7.2 Step 1 — Plan (dry run)

The user (or an agent, relayed through a human) fills the tool's inputs, generated as a form from the JSON Schema via `zod` + `react-hook-form`. The action is labelled **"Plan this change"** — never "Run", never "Submit".

The plan response renders as a **Plan Review card**, the most designed component in the product. Anchored in `--status-write` (amber) with a `--status-write` left rule, on `--bg-surface-2`. Contents, in this order, because the order is the argument:

1. **The plan sentence, in `--font-body-lg`, as the first and largest thing on the card.** This is the `plan` string from the gateway, rendered verbatim. *"Create an AP voucher for supplier 4242 (ACME LTD) for 18,400.00 GBP, company 00100, GL date 2026-08-27, matched to PO 0000451. This creates an OPEN PAYABLE in JD Edwards."* No paraphrase, no truncation, no tooltip. If the sentence is too long for the card, the card grows.
2. **Effects table** — one row per entry in `effects`: system, object, action, reversible. `reversible: false` rows are chipped danger and pulled to the top.
3. **Warnings** — each `warnings` entry as an amber inline note with its own icon. *"PO 0000451 is only 60% receipted."*
4. **Guardrails evaluated** — every guardrail on the tool, with pass/fail and the value checked. Showing the guardrails that *passed* is deliberate: it tells the approver what was actually enforced, not just what failed.
5. **The reversal contract** — class, the reversing tool (linked), the window (`720 hours`, rendered also as *"until 26 Sep 2026"*), and the preconditions. For `irreversible`, this block becomes a filled danger banner reading **"This cannot be undone"** with the reason, and it appears *above* the effects table rather than below it.
6. **Identity block** — who is executing, whether identity carries into the target for this binding, and if not, which compensating control applies. Sourced from the probe, not the manifest.
7. **Arguments, locked** — the canonical arguments as they will be sent, with the short `argsHash` (first 8 chars, mono) beside them. Locked means the inputs above are now read-only.
8. **Expiry** — a live countdown to `expiresAt`, in words (`expires in 4:12`), with an accessible live region announcing at 60s and 10s.
9. **Actions** — `Confirm and execute` (primary, coral) · `Change arguments` (secondary, re-opens the form and voids the plan) · `Discard plan`.

### 7.3 Step 2 — Confirm

The confirm is not a second screen; it is the primary action on the Plan Review card, because splitting it adds a click without adding information. What varies is the **friction**, which scales with consequence:

| Condition | Affordance |
|---|---|
| Reversible write, non-financial, non-prod | Primary button. One click. |
| Financial sensitivity, or any prod environment | Primary button + a checkbox: *"I have read the plan above"* — unchecked by default, focusable, labelled. |
| `reversal.class: irreversible` | **Type-to-confirm**: the user types the tool's entity name (`voucher`) into a field. Nothing else unlocks the button. |
| Deployment-wide actions (kill switch) | Type-to-confirm with the deployment id. |

Three refusal states must render as **distinct, explained outcomes, not toasts**:

- **`PLAN_EXPIRED`** — the card greys, the countdown becomes "Expired", and the only action is `Plan again`. The original plan text stays visible so the user can see what they lost.
- **`PLAN_ARGUMENT_MISMATCH`** — this is the one that catches a real attack (an agent planning £100 and executing £100,000). It renders as a danger banner **naming the exact fields that changed, with old and new values side by side**. Never "invalid request".
- **`POLICY_GUARDRAIL_BREACH`** — the guardrail's own `message` verbatim, the rule that fired, the value that breached it, and the `next` hint. If the rule was `sodConflict`, it names the conflicting grant and the roles that produced it, because "you hold both create and approve" is only actionable if the person knows which roles gave them each.

### 7.4 Step 3 — Approval gate (when `humanApprovalRequired`)

When the plan comes back `awaiting_human_approval` instead of `confirm_required`, the card changes shape rather than the flow branching to a different screen:

- **Requester's view:** the same plan content, with the actions replaced by a status block — approval id, the named approver(s), when it was raised, and a live state. Plus a copyable link (the `approvalUrl` the gateway returned) so the requester can chase it out of band. **No polling spinner as the only feedback** — the state block says "waiting for Meera Rao since 14:02" because a named person is more actionable than a spinner.
- **Approver's view** (`/approvals/[approvalId]`): the plan text, unmodified, as the largest element. Beside it: who is asking, under which role, which tool, which environment, and the **plan hash short form** — the approver is approving *that exact plan*, and the hash is what makes that claim true rather than rhetorical. Below: effects, warnings, guardrails, reversal contract, identity block — the same blocks as the plan card, because an approver needs everything the requester saw and nothing less. Actions: `Approve` · `Decline` (requires a reason, which is returned to the agent as the `next` string) · `Approve with note`.
- On approve, the gateway mints the confirm token and the **requester's card transitions to `APPROVED`, with the confirm action now live**. The approver does not execute; the requester does. This separation is deliberate and matches the architecture: approval unlocks the token, it does not perform the write.
- Approvals expire with their plan. The approver's queue shows the countdown, and an expired approval is shown as expired rather than silently disappearing.

### 7.5 Step 4 — Execute, and Step 5 — Reverse

**Execute** shows a determinate-feeling progress state with the `correlationId` visible from the first moment (so a failure is traceable even if the browser is closed), then resolves to a **Result card**:

- The `summaryTemplate` rendered — *"Voucher 00123456 created for 4242, 18,400.00 GBP."*
- **Result keys as first-class chips** — `document_number 00123456` · `document_type PV` · `document_company 00100`, each click-to-copy and each linked into Activity's business-key search. These are the reversal handle and the audit handle; they get prominence, not a details expander.
- The audit record link, the latency breakdown (gateway vs target), and the identity echo (`target_identity_observed` vs expected — with a mismatch rendered as a danger banner, because that is the OIC/`function` risk showing up live).
- **`replayed: true`** renders as its own visibly distinct state: *"This call was already made at 14:03. The original result is shown. Nothing was executed."* An idempotent replay that looks identical to a fresh execution is a UX failure that produces duplicate-payable panic.

**Reverse** lives on the completed call, in two places: the Result card immediately after execution, and the call detail in Activity forever after (within the window).

- The action is labelled with the actual reversing tool: **"Reverse — cancel this voucher (`jde.ap.voucher.cancel`)"**. Never a generic "Undo".
- The reversal window renders as a countdown in days and a date.
- Preconditions from the manifest render as a checklist evaluated live where possible (*"Voucher must be unpaid and not yet posted to a closed period"*).
- **A reversal is itself a write, so it runs the full plan → confirm sequence.** Same components, same rigour. It is not a shortcut, and the UI does not pretend it is.
- After reversal, both calls render linked in both directions (`reverses_call_id` / `reversed_by_call_id`), and the original call's row in Activity carries a `REVERSED` chip. A reversal that is invisible from the original call is a broken audit story.
- `class: irreversible` renders the action as a disabled control **with the reason in place of a tooltip** — a disabled button with no visible explanation is one of the most common accessibility and comprehension failures in enterprise UI.

### 7.6 Component inventory for the write path

Named so Phase 4 can task them directly: `PlanReviewCard`, `PlanSentence`, `EffectsTable`, `WarningList`, `GuardrailResultList`, `ReversalContract`, `IdentityBlock`, `LockedArgs`, `PlanExpiryCountdown`, `ConfirmAction` (variants: `simple` / `acknowledge` / `type-to-confirm`), `ApprovalGateCard`, `ApproverDecisionPanel`, `ExecutionProgress`, `ResultCard`, `ResultKeyChip`, `ReplayNotice`, `ReversalAction`, `RefusalBanner` (variants per error code), `WritePathStepper`.

`WritePathStepper` deserves a note: a five-step horizontal stepper (Plan · Confirm · Approve · Execute · Reverse) sits at the top of the flow, with steps that do not apply (Approve, when not required) rendered as skipped rather than hidden. **Showing the skipped approval step is the point** — it tells the user that this tool did not need one, which is information, whereas hiding it makes the two cases indistinguishable.

---

## 8. Where change state and status appear — the badge vocabulary

A dense console lives or dies on a small, consistent chip vocabulary. Six chip families, no more. Every chip has a text label, a shape/glyph, and an accessible name (§12.5) — colour never carries the meaning alone.

| Family | Values | Colour role | Where |
|---|---|---|---|
| **Change state** | draft · validating · invalid · in review · changes requested · approved · merged · deployed | neutral → amber → green, danger for invalid | every editable entity: tool, role, package, guardrail |
| **Probe status** | resolved · degraded readonly · disabled (missing binding / no grant / identity unverified / schema drift / kill switch) | ok · write · danger | tool rows, tool detail, enablement backlog, catalog facet |
| **Binding type** | REST · DB/SQL · PL/SQL · Function · Wrapped | read · platform · write · neutral · ok | tool rows and cards, tool detail, security posture table, build form, slice manifest |
| **Verb / write** | the 17 closed verbs; `write` as a separate emphatic chip | read verbs neutral, write verbs amber | everywhere a tool appears |
| **Package / slice** | package labels | platform (purple) | server rows, tool detail, packages page |
| **Call phase / outcome** | plan · execute · reject · reverse; ok · business error · policy denied · binding error · timeout | read · ok · write · danger | activity rows, call detail |

Plus two singular indicators that are not chips: the **environment chip** (§11) and the **sensitivity marker** (a small left rule on rows whose tool is `financial` or `personal`, not a chip, because it applies to the whole row).

---

## 9. Fast tool discovery — the human surface

This is the user-facing expression of Phase 1's efficiency goal. There are two surfaces solving the same problem and they are deliberately different (§10 covers the agent side).

### 9.1 The command palette is the primary surface

`⌘K` / `Ctrl+K` from anywhere, plus a permanently visible trigger in the topbar centre. It is not a nice-to-have shortcut; it is the intended way a person finds a tool, and its prominence reflects that.

**It is backed by `forge.find` over the gateway API — the same index, the same ranking, the same score floor as the agents use.** That is a design decision with teeth: it means a human who cannot find a tool has discovered a real discovery defect, not a UI defect, and the failure is worth logging. A separate portal-only search index would let the two surfaces drift, and the drift would hide the exact problem the benchmark exists to catch.

### 9.2 Interaction

```
┌───────────────────────────────────────────────────────────────┐
│  ⌘K   record a supplier invoice against a PO                  │
├───────────────────────────────────────────────────────────────┤
│  TOOLS                                                        │
│  ▸ jde.ap.voucher.create        [write] [Function] [resolved] │
│    Create an AP voucher against a supplier, optionally...     │
│  ▸ jde.ap.voucher.search        [read]  [Function] [resolved] │
│    Find vouchers by supplier, date or amount.                 │
│    ┌ Which one? ─────────────────────────────────────────┐    │
│    │ voucher.create makes a NEW voucher. voucher.search  │    │
│    │ finds existing ones when you do not know the number.│    │
│    └─────────────────────────────────────────────────────┘    │
│  ▸ jde.scm.purchase_order.get_receipt_status  [read] [disabled]│
│    Disabled: identity could not be verified for this binding. │
│                                                               │
│  GO TO      Approvals · Enablement backlog · My drafts        │
│  ACTIONS    Plan a write… · Propose a change… · Run probe     │
└───────────────────────────────────────────────────────────────┘
```

**Rules:**

1. **Typed filter grammar, discoverable inline.** `app:jde`, `verb:create`, `write:true`, `binding:plsql`, `package:jde-fin`, `role:p2p`, `status:disabled`, `sens:financial`. Typing `app:` offers completions. The grammar maps 1:1 onto `forge.find` parameters and onto the Catalog facets — one mental model, three places.
2. **Results are tool cards, rendering the same fields the agent card carries** — id, purpose, verb, write, binding, sensitivity, status. Not a different summary. This is what makes §10.4's "see what the agent sees" claim true rather than decorative.
3. **The `choose` block renders when it fires.** When the top two results are within the ranking margin and share an entity prefix, the gateway returns a disambiguation string; the palette renders it inline, as above. This single line resolves the `.get` / `.search` / `.create` confusion class for humans exactly as it does for agents.
4. **Disabled tools appear, with their reason.** Same resolution as the agent contract (Phase 2 §4.5): a disabled tool is excluded from `tools/list` but *findable*, with its `agentMessage` and its owning team. A person searching for a capability that exists but is switched off must be told that, not shown an empty result.
5. **`no_tool` is a designed result, not an empty state.** It renders the `reason`, the nearest capabilities with their scores, and a primary action: **"Request this capability"** — which opens Requests pre-filled with the query text. This is the exact hand-off from discovery to intake, and it is where the demand-driven catalogue goal (G9) gets its input.
6. **Actions and navigation are in the palette too**, ranked below tools. Go-to destinations, "Plan a write…", "Propose a change…", recent items, pinned tools. Recents and pins are per-user browser-local state.
7. **Keyboard grammar:** `↑`/`↓` move, `Enter` opens detail, `⌘Enter` opens the run/plan panel directly, `⌘.` cycles the view (tools / actions / pages), `Esc` closes and returns focus to the trigger. Every one is listed in a `?` shortcut sheet.
8. **Latency budget: results render within 150ms of a keystroke pause of 120ms.** The index is in gateway memory and is a few hundred kilobytes; there is no excuse for a spinner in this component, and a spinner here would defeat its purpose.

### 9.3 The slow path

Catalog's faceted browse (§5.3) is the deliberate slow path — for exploring what exists, for auditing a slice, for a business user who does not know the vocabulary yet. Palette answers "I know roughly what I want"; Catalog answers "show me what there is." Both are needed and they should not be merged.

### 9.4 One index, three consumers

```
generated/index/catalogue-index.json
        │
        ├── forge.find (MCP tool)          → agents
        ├── /api/find (gateway HTTP)       → command palette + Catalog search
        └── /api/find (gateway HTTP)       → Requests dedupe verdict
```

The Requests dedupe verdict, the palette, and the agent all get the same answer to the same question. Building any of the three on a separate index would be the single most likely way this product's efficiency claims quietly stop being true.

---

## 10. Fast tool discovery — the agent surface

The second surface. An agent driving MCPForge never sees the portal. What it sees is text the gateway returns — and that text is a designed artefact with a style guide, reviewed like UI, budgeted like UI, and rendered in the portal so humans can inspect it.

### 10.1 What "good discovery" looks like from the agent's seat

A good session, in the agent's own terms:

1. **`initialize` → `tools/list` returns a small, relevant set.** Not 150 tools. The role's core set, capped by the CI-enforced 1,300-token role budget, plus the four always-resident meta-tools (~440 tokens). The agent's first impression of the estate is "here are about a dozen things I can do," not "here is a catalogue."
2. **The four meta-tools are self-explanatory from their descriptions alone.** `forge.find` reads as "describe what you want in English and I will find it." `forge.describe` reads as "get the full schema before you call." `forge.activate` reads as "tell me what you are working on and I will change what is listed." `forge.invoke` reads as "call anything you are granted without re-listing." An agent should not need a system prompt to use them correctly — the descriptions are the documentation.
3. **One `forge.find` call answers the question.** Median 2 hops from intent to correct call (Phase 1 M-3). The result is ≤5 cards of ≤60 tokens each plus a `guidance` line, and the right one is first (SA@1 ≥90%).
4. **Ambiguity is resolved in the response, not by a second round trip.** The `choose` block does this. One extra line beats one extra hop.
5. **A miss is a clean, actionable miss.** `no_tool` says what is not covered, names the nearest capabilities, and explicitly instructs the agent **not to approximate** — *"Do not attempt to approximate it with another tool."* An agent told to stop is worth more than an agent given a plausible wrong tool.
6. **A switched-off capability says so, with an owner.** *"This capability exists but is disabled: identity could not be verified for this binding. Do not retry; it will not succeed until the owning team enables it."* Not silence, not a retry loop.
7. **Every error names the next move.** The closed error enum's `next` field is non-empty on every path, enforced by a generated unit test per tool. Zero dead ends.
8. **A write reads like a contract, not a form submission.** The plan sentence names the system, the object, the amounts and the business consequence in one readable sentence — *"This creates an OPEN PAYABLE in JD Edwards"* — so that an agent relaying it to a human relays something a human can actually judge. **The plan string is the entire UI in a chat client.** It is the highest-stakes copy in the product.
9. **Growth is invisible.** Adding a module server does not change any of the above for an unrelated role. The agent's experience of a 42-server estate is identical to its experience of a 3-server one.

### 10.2 How the two surfaces differ, deliberately

| | **Human (command palette)** | **Agent (`forge.*` meta-tools)** |
|---|---|---|
| **Entry** | Keystroke, always available | Tool call, from an always-resident set |
| **Optimises** | Recognition — scan, compare, pick | Precision — one right answer, cheaply |
| **Ambiguity** | Show both, let the eye choose; `choose` block as support | `choose` block is *required* — the agent cannot scan |
| **Cost model** | Screen space and seconds | **Tokens.** Every extra field is paid for on every session |
| **Result count** | 8–10, scannable | ≤5, hard-capped by `limit` |
| **Facets** | Visible checkboxes and pills — exploration is the point | Optional JSON parameters — the agent already knows what it wants |
| **Disabled tools** | Shown with reason and owning team | Shown with `agentMessage`, and excluded from `tools/list` to protect the budget |
| **On a miss** | "Request this capability" button into intake | `next` string pointing at Business Intake, and an instruction not to approximate |
| **Fixing a wrong result** | The user re-types | Nobody re-types. A wrong result is a benchmark failure. |
| **Failure mode** | Frustration | Silent wrong action |

The last row is the whole reason these are two designs. A human who gets a bad search result tries again. **An agent that gets a plausible wrong tool creates a voucher.** That asymmetry is why the agent surface has a calibrated score floor, mandatory disambiguation, and negative cases in CI — and why the human surface can afford to be generous.

### 10.3 Agent-facing copy standards — a real part of the design system

These strings are UI. They live in the manifest, they are reviewed in the PR, and they are budgeted by codegen. The style guide:

| Field | Rule | Example |
|---|---|---|
| `purpose` | ≤14 words. Verb-first. Says what it does, never how. No product names, no "This tool…". | *Create an AP voucher against a supplier, optionally matched to a PO.* |
| parameter `desc` | ≤12 words. One line. Names the unit or format if there is one. | *Gross amount in company currency.* |
| `disambiguation` | One sentence per sibling, naming each by id. Written by the steward. | *Creates a NEW voucher. To find existing vouchers use `jde.ap.voucher.search`…* |
| `planTemplate` | One or two sentences. Names system, object, amounts, and the **business consequence in plain words**. Ends with what changes. | *…This creates an OPEN PAYABLE in JD Edwards.* |
| guardrail `message` | States the limit and the actual value. Never "invalid". | *Voucher amount exceeds the MCPForge ceiling for this tool.* |
| error `next` | **Mandatory.** Names a tool id or a human action. Never "try again". | *Use `jde.scm.purchase_order.get_receipt_status` to confirm status, or create the voucher without a PO match by omitting `po_number`.* |
| probe `agentMessage` | States existence, the reason it is off, and whether to retry. | *This capability exists but is disabled… Do not retry; it will not succeed until the owning team enables it.* |
| probe `remediation` | For humans, not agents. Names the action and the owning role. | *Configure the AIS token provider for SSO on PY920… Owner: JDE CNC.* |

Two review gates make this real rather than aspirational: **codegen fails** on a `purpose` over 14 words, a parameter `desc` over 12, a missing `disambiguation` on a sibling pair, or an error path with an empty `next`; and the **PR template** for any manifest change includes a copy review checklist covering the plan template and the guardrail messages.

### 10.4 "Agent view" — the bridge between the two surfaces

Every tool detail page carries an **Agent view** toggle. It renders, side by side, the three representations exactly as an agent receives them, each with its **measured token count against its budget**:

| Representation | Budget | Rendered as |
|---|---|---|
| **Card** (what `forge.find` returns) | ≤60 | the JSON, plus the count |
| **Resident definition** (what `tools/list` carries) | ≤200 typical / 400 hard | the JSON, plus the count |
| **Full description** (what `forge.describe` returns) | ≤600 | the JSON, plus the count |

Plus a **role simulator**: pick a role, see the exact `tools/list` an agent holding it would receive, with the total resident token count against the 1,300 role budget and a warning when a tool would need demoting from `coreTools`.

This is the most useful screen in the product for anyone authoring tools, and it exists because of a simple observation: **nobody writes good agent-facing copy that they never see rendered.** It also makes the token-efficiency goal tangible to people who otherwise only meet it as a CI failure.

---

## 11. Environment and state indicators

Wave 0 runs local-first with SQLite; OCI is the eventual production target; the same UI runs in both. The user has to be able to tell, instantly and without hunting, what they are looking at — **without** building multi-user presence features that do not apply at Wave-0 scale.

### 11.1 The environment chip

Always in the topbar, immediately left of the persona pill. Four classes, matching Phase 2 §7.1 exactly:

| Class | Label | Treatment | Extra behaviour |
|---|---|---|---|
| `local` | **Local dev** | neutral outline chip, plus a 3px `--status-platform` rule along the very top of the viewport | data-class chip beside it (§11.2) |
| `probe` | **Probe** | `--status-read` outline | banner on first visit per session: destructive classification runs here |
| `staging` | **Staging** | `--status-write` outline | — |
| `prod` | **Production** | `--status-danger` **filled** chip, plus a 3px `--status-danger` rule along the top of the viewport | write confirmations gain the acknowledge checkbox (§7.3); kill-switch actions gain type-to-confirm |

**The top-of-viewport rule is the mechanism that works when nobody is looking at the chip** — the peripheral cue that answers "am I in prod" from six feet away, and the one that survives a screenshot pasted into a chat. Production is the only environment that gets a filled chip; the asymmetry is the signal.

Clicking the chip opens a popover with the full deployment fingerprint (also the Environments landing tab): environment class, gateway version, bundle version, deployed package, catalogue artefact digest, datastore kind and location, git remote, identity provider, last probe run, kill flags in force.

> **EXTENDED by §16.5 — Phase 5.** The deployment fingerprint gains the **secret-store kind** and a count of credentials past their rotation window, beside the existing datastore kind.

### 11.2 The data-class chip — "is this ephemeral?"

Immediately beside the environment chip when the runtime store is not a managed database:

> **`SQLite · local file`** — tooltip: *"Runtime data (audit, approvals, probe results) is stored in a local SQLite file at `./.mcpforge/runtime.db`. It is not backed up and does not survive a clean checkout. Definitional data is in git and is safe."*

That tooltip is the whole design: **it separates what is ephemeral from what is not.** The most common confusion in a local-first product with a git-backed definitional store is a person assuming their work is gone when their audit log is gone, or assuming their audit log is safe because their manifests are. Saying which half is which, at the point of the indicator, resolves it.

When the store is Postgres (or Oracle later), the chip shows the store kind and the host alias and drops the ephemerality language. The chip is driven by a single gateway API field (`runtime.store.kind`), so nothing needs redesigning at migration time.

Two companion behaviours:
- **Audit surfaces carry the ephemerality note in their empty state.** *"No calls recorded yet. This local instance stores audit records in SQLite; they start empty on a fresh checkout."* — because the emptiest screen is where the question gets asked.
- **`forge audit verify` results show the chain's origin**, so a short chain on a local instance reads as expected rather than alarming.

### 11.3 Git-host-agnostic indicators

Wave 0 assumes local git only, with no hosted platform. The change model still applies — branches, commits, and a local PR abstraction — so the UI must not name a platform it may not be talking to:

- The branch chip shows the branch and, on hover, the remote (`origin` or *"local only — no remote configured"*).
- "Propose" opens a **change proposal**, which maps to a PR when a host is configured and to a local branch-plus-review-record when it is not. The vocabulary in the UI is "change" and "review", never "GitHub pull request".
- When no remote is configured, the Propose dialog carries a one-line note: *"No git remote is configured. This proposal is recorded locally and can be pushed later."* Once a remote exists, the note disappears and the PR link appears in its place. Nothing else changes.

### 11.4 Staleness, not presence

Deliberately **not built at Wave 0**: who else is viewing, live cursors, real-time collaborative editing, presence avatars, live-updating queues. At Wave-0 scale these are cost with no benefit, and Phase 2's datastore decision does not support them.

Built instead — **staleness indicators**, which solve the same underlying anxiety ("is what I am seeing current?") at a fraction of the cost:

- Every runtime-data surface carries a `Updated 4m ago` marker with a manual refresh, positioned consistently at the top-right of the panel.
- The probe report shows its run timestamp prominently, and marks itself **stale** past 24 hours with an amber chip and a "run probe" action.
- The catalogue shows the artefact digest and the commit it was built from.
- Approvals and Activity poll on a slow interval (30s) and mark themselves updated; they do not stream.
- **The one exception is the plan expiry countdown**, which is client-side and ticks in real time, because a stale countdown on a live security control is genuinely dangerous.

When a concurrent change is detected on save (the branch moved under the editor), the UI shows a **conflict panel with both versions and a re-base action** — this is the only "someone else is here" feature Wave 0 needs, and it is reactive rather than ambient.

---

## 12. Accessibility bar

**The standard: WCAG 2.1 Level AA, for the whole portal, no exemptions.** Below are the criteria that actually bite for a dense enterprise data console, each with the concrete rule and how it is checked. This is written as a checklist because it needs to be one.

### 12.1 Contrast (1.4.3, 1.4.11) — both themes

- All text ≥4.5:1 against its actual background (not the canvas). Large text (≥18.66px bold / ≥24px) ≥3:1.
- **All measured values and the token decisions they forced are in §4.6.** The three that matter: dark-mode status text uses the `-300` steps, not the canonical `-500`s; light-mode coral text is `#B23A2C`, not `#F2665B`; dark-mode primary buttons use ink text on coral, not white.
- UI component boundaries and states ≥3:1 (1.4.11): focus rings, input borders, checkbox outlines, chip outlines, chart marks, the selected-row indicator.
- **Checked automatically:** a token-contrast unit test asserts every `--text-*` / `--bg-*` pair and every `--status-*` text token in both themes. It runs in CI and fails the build. This is a test over the token file, not a visual review, so it cannot rot.

### 12.2 Keyboard — every interactive element, including the write path (2.1.1, 2.1.2, 2.4.3, 2.4.7)

- **Every action reachable and operable by keyboard, with no traps.** The specific gaps that need naming because they are the ones that get missed:
  - The **plan → confirm → approve → execute → reverse** sequence end to end, including the type-to-confirm field and the acknowledge checkbox. A write must be completable without a mouse.
  - **The approver's decision panel** — approve, decline, and the decline-reason field.
  - The **facet pill rows** (roving tabindex within the group, `Tab` moves between groups — not 40 tab stops to cross a filter bar).
  - The **data grid**: `Tab` enters the grid as one stop, arrow keys move between cells, `Enter` opens the row, `Esc` leaves. A 150-row virtualised table with 150 tab stops is unusable and technically compliant, which is why this is specified rather than assumed.
  - The **command palette**: full grammar in §9.2, plus focus returning to the trigger on close.
  - The **graph views** (consumption, spider map) — canvas interaction is not keyboard-navigable in any satisfying way, so **each graph ships with an equivalent table view toggled by a visible control**, and the table is the accessible path. This is an equivalent-alternative approach, taken deliberately.
- **Visible focus everywhere:** 2px `--focus-ring` with 2px offset, on every focusable element, never removed. `:focus-visible` for pointer users, `:focus` fallback. The ring colour is a token so it inherits contrast correctness in both themes.
- **Skip link** to main content, first tab stop.
- **Shortcuts:** `⌘K` palette, `?` shortcut sheet, `g` then a letter for go-to. All single-key shortcuts are disabled while a text input has focus (2.1.4), and all are listed in the `?` sheet.

### 12.3 Focus management in modals and drawers (2.4.3, 4.1.2)

Radix gives most of this; these are the rules it must be configured to follow:

- On open: focus moves to the dialog, on its heading or its first interactive element. Focus is trapped inside. Background is `aria-hidden` and inert.
- On close: focus returns to the element that opened it. **Including when a drawer is closed by `Esc`, by a scrim click, or by completing an action** — the last one is where implementations usually drop it, e.g. a tool drawer closed by clicking "Run" must land focus in the run panel, not at the top of the document.
- The tool detail drawer is a `dialog` with `aria-labelledby` pointing at the tool title, and it is also a route — so a browser back closes it and restores focus to the originating row.
- **The Plan Review card is not a modal.** It is inline content in the flow, because trapping a user in a modal while they read a financial plan and possibly need to check something else on the page is hostile. Only the type-to-confirm escalation for irreversible actions uses a true modal, and it names what it is confirming in its heading.
- Toasts never steal focus. Anything requiring a decision is never a toast.

### 12.4 Live regions and status announcements (4.1.3)

- Plan state transitions announce on a `role="status"` (polite) region: *"Plan ready. Expires in 5 minutes."* / *"Approved by Meera Rao. You can now confirm."* / *"Executed. Voucher 00123456 created."*
- Refusals announce on `role="alert"` (assertive), because a refusal is not something to discover later.
- The expiry countdown announces at 60s and 10s only — a per-second live region is unusable noise.
- Async table loads announce the result count: *"47 tools."*
- Validation errors in the Build editor are associated with their field via `aria-describedby` and summarised in a focusable error list at the top of the form.

### 12.5 Screen-reader labelling for chips and badges (1.3.1, 1.4.1, 4.1.2)

This is the criterion most at risk in this product, because the product is largely made of chips.

- **Every chip has a visible text label.** No icon-only status. Colour is never the only differentiator (1.4.1) — the binding-type chips differ by their text (`REST`, `DB/SQL`, `PL/SQL`, `Function`, `Wrapped`) first, and by colour second.
- **Every chip carries an accessible name that expands the abbreviation**, via `aria-label` or visually-hidden text:
  - Binding: `PL/SQL` → *"Binding type: PL/SQL package. Identity does not carry natively; wrapper-schema attribution only."*
  - Probe status: `disabled` → *"Probe status: disabled — identity unverified. Owner: JDE CNC."*
  - Change state: `in review` → *"Change state: in review. Proposed by Priya, 2 days ago."*
  - Package: `JD Edwards Financials` → *"Deployment package: JD Edwards Financials."*
  - Write: `write` → *"This tool writes to the target system."*
- **Rows are not a wall of unlabelled chips.** Each table cell containing chips has a column header association, so a screen reader reads *"Binding type: PL/SQL"* rather than *"PL/SQL"* floating in a row.
- Icon-only buttons (copy, refresh, expand) always carry an `aria-label`, and their tooltip text and accessible name match.
- Redacted values announce as redacted, not as their hash: *"Redacted value, hash 3f9a2b1c8e04."*

### 12.6 Structure, semantics, and the rest

- One `<h1>` per page (the page title), heading levels never skipped, landmarks (`banner`, `navigation`, `main`, `complementary`) on the shell.
- **Tables are real tables** with `<th scope>`, captions, and `aria-sort` on sortable headers. A grid built from divs in a console like this is a defect.
- **Text resize to 200% and reflow at 320 CSS px width (1.4.4, 1.4.10):** the shell collapses to the icon rail, facets collapse to a sheet, tables scroll horizontally *within their own container* — the page body never scrolls horizontally. Because everything is rem-based (§4.5), browser font-size settings work without a custom zoom control.
- **Reduced motion (2.3.3):** one media block collapses all durations to 1ms. No parallax, no auto-playing anything, and no animated transition anywhere in the write path.
- **Forms (3.3.1, 3.3.2, 3.3.3):** every input has a persistent visible label (never placeholder-as-label), errors are text beside the field naming the fix, and required fields are marked in text as well as colour.
- **Language and titles (2.4.2, 3.1.1):** `<html lang="en">`, unique descriptive `<title>` per route.
- **Target size:** interactive targets ≥24×24 CSS px with adequate spacing, including in `compact` density. This is what bounds how compact `compact` is allowed to be.

### 12.7 How it is enforced

| Gate | Tool | Fails on |
|---|---|---|
| Token contrast | Vitest unit test over `tokens.ts`, both themes | any pair below its threshold |
| Component a11y | `jest-axe` / `axe-core` on every component story | any violation at `serious` or above |
| Page a11y | `@axe-core/playwright` on every route, **both themes**, in the E2E suite | any violation |
| Keyboard flows | Playwright keyboard-only scripts for: plan→confirm→execute, approve, reverse, palette search, facet filtering, role edit | any step unreachable |
| Manual | A screen-reader pass (NVDA on Windows, the realistic target) on the write path and the catalog, once per wave, recorded in the checkpoint artefact | judgement |

The first four are CI gates and **may not be marked "allowed to fail"** — the same rule Phase 2 §7.2 applies to the token-budget and discovery-benchmark gates. Accessibility that is checked by a person once a quarter is accessibility that regresses in week two.

---

## 13. Design tokens as code artefacts

Concrete enough for Phase 4 to make a scaffolding task out of it without further design input.

### 13.1 Files and ownership

```
core/portal/src/design/
  tokens.primitives.css     # Tier 1. The LTM palette + ramp steps. Rarely edited.
  tokens.semantic.css       # Tier 2. Light on :root; dark overrides. THE theme file.
  tokens.component.css      # Tier 3. The ~8 component-specific aliases.
  tokens.ts                 # GENERATED. Typed export for JS consumers. CI-verified clean.
  build-tokens.ts           # The generator: parses the CSS, emits tokens.ts.
  contrast.test.ts          # The §12.1 gate.
core/portal/src/styles/
  globals.css               # @import the three token files, then @theme, then base styles.
core/shared/src/
  status.ts                 # Status enums → { token, label, srLabel, icon }. Shared portal + CLI.
```

**`tokens.semantic.css` is the source of truth for colour.** `tokens.ts` is generated from it, never hand-edited, and `git diff --exit-code` on it is a CI gate — **exactly the pattern Phase 2 §7.2 stage 3 already applies to `generated/`.** The design system obeys the same manifest-first discipline as the product, which is both correct and a useful piece of internal consistency: one rule ("generated artefacts are committed and verified clean"), applied everywhere.

### 13.2 The theme mechanism

Three states, matching how viewers actually set themes: an explicit choice stamps `data-theme` on `<html>`; the default "system" stamps nothing and follows `prefers-color-scheme`.

```css
/* tokens.semantic.css */

/* 1. Light is the complete, unconditional baseline. Every token defined here. */
:root {
  --bg-canvas:  var(--ltm-grey-200);
  --bg-surface: var(--ltm-grey-100);
  --text-1:     var(--ltm-ink-900);
  --text-3:     #6E7379;                 /* raised from #767B82 — see §4.6 */
  --accent:            var(--ltm-coral-800);
  --accent-solid-bg:   var(--ltm-coral-700);
  --accent-solid-fg:   #FFFFFF;
  --status-read:  var(--ltm-blue-700);
  --status-ok:    var(--ltm-green-700);
  --status-write: var(--ltm-amber-700);
  --status-platform: var(--ltm-purple-700);
  --status-danger:   var(--ltm-coral-800);
  /* …full set… */
}

/* 2. System dark, only when no explicit light choice is stamped. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark values — identical list to 3 */ }
}

/* 3. Explicit dark wins in both directions. */
:root[data-theme="dark"] {
  --bg-canvas:  var(--ltm-ink-900);
  --bg-surface: var(--ltm-ink-800);
  --text-1:     var(--ltm-grey-100);
  --text-3:     var(--ltm-grey-750);
  --accent:            var(--ltm-coral-500);
  --accent-solid-bg:   var(--ltm-coral-500);
  --accent-solid-fg:   var(--ltm-ink-900);   /* ink on coral — 5.50:1 */
  --status-read:  var(--ltm-blue-300);
  --status-ok:    var(--ltm-green-300);
  --status-write: var(--ltm-amber-300);
  --status-platform: var(--ltm-purple-300);
  --status-danger:   var(--ltm-coral-500);
  /* …full set… */
}
```

**Rules the build lane must follow, stated because they are the ones that get broken:**
1. **No colour may have its only definition inside a media query or a `[data-theme]` block.** Every token exists on bare `:root` first.
2. **The dark list in (2) and (3) is identical.** Generated from one source array by `build-tokens.ts` so it cannot drift.
3. `<body>` always has an explicit `background: var(--bg-canvas)`. A transparent body borrows whatever is behind it.
4. Theme is applied by an inline script in `<head>` before first paint (read `localStorage.mcpforge-theme`, stamp `data-theme`), so there is no flash. `localStorage` access is wrapped in `try/catch` — it throws in some contexts, and the page must render correctly with no stored value.
5. **Charts read their colours from CSS custom properties at render time** (`getComputedStyle`), not from a hard-coded JS array, so they theme with everything else.

### 13.3 Tailwind wiring

```css
/* globals.css */
@import "tailwindcss";
@import "../design/tokens.primitives.css";
@import "../design/tokens.semantic.css";
@import "../design/tokens.component.css";

@theme inline {
  --color-canvas:  var(--bg-canvas);
  --color-surface: var(--bg-surface);
  --color-text-1:  var(--text-1);
  --color-accent:  var(--accent);
  --color-status-write: var(--status-write);
  /* …one entry per semantic token… */
  --font-display: Cambria, Georgia, "Times New Roman", serif;
  --font-sans:    var(--font-inter), "Segoe UI", system-ui, sans-serif;
  --font-mono:    "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;
  --radius:       10px;
}
```

Components then write `bg-surface text-text-1 border-line`. Because the utilities resolve to `var(--bg-surface)`, **a theme switch requires zero component changes** — which is the property that makes "a real light mode, not a reskin" achievable by an autonomous build lane rather than a design pass.

### 13.4 `tokens.ts` — the generated typed export

```ts
// GENERATED by build-tokens.ts — do not edit. CI verifies this file is clean.
export const tokens = {
  light: { bgCanvas: "#F4F5F7", bgSurface: "#FFFFFF", text1: "#1A1D21", /* … */ },
  dark:  { bgCanvas: "#1A1D21", bgSurface: "#202327", text1: "#FFFFFF", /* … */ },
} as const;

export type ThemeName  = keyof typeof tokens;
export type TokenName  = keyof typeof tokens.light;
```

Consumers: the contrast test, chart fallback values, any canvas rendering, and the `forge` CLI's terminal colour output (so a status chip in the portal and a status line in the CLI mean the same thing). Not consumed by components — components use utility classes.

### 13.5 `status.ts` — one vocabulary, two products

```ts
// core/shared/src/status.ts
export const PROBE_STATUS = {
  resolved:                     { token: "status-ok",     label: "Resolved",
    srLabel: "Probe status: resolved. This tool is callable." },
  degraded_readonly:            { token: "status-write",  label: "Degraded (read-only)",
    srLabel: "Probe status: degraded. Read-only; writes are disabled for this binding." },
  disabled_identity_unverified: { token: "status-danger", label: "Disabled — identity unverified",
    srLabel: "Probe status: disabled. Identity could not be verified for this binding." },
  /* …the full closed enum from Phase 2 §4.5… */
} as const;
```

Same shape for `CHANGE_STATE`, `BINDING_TYPE`, `CALL_PHASE`, `CALL_OUTCOME`, `ERROR_CODE`, `REVERSAL_CLASS`, `VERB`. **These enums are already closed in Phase 2** — this file is the single place their human-facing label, accessible label and colour token are defined, and it lives in `core/shared` because the CLI needs it too. A status that renders one way in the portal and another in `forge audit --json` is a small thing that erodes trust in both.

### 13.6 Lint rules that keep it honest

Three ESLint rules, in `core/portal/eslint.config.js`:

1. **`no-raw-color`** — no hex, `rgb()`, or `hsl()` literal in any `.tsx` or `.css` outside `tokens.primitives.css`. This is what makes "non-designers can extend it consistently" true rather than hopeful.
2. **`no-retired-brand-strings`** — blocks `LTIMindtree`, `OraAIX`, `OraFORGE`, `OMF`, and the retired hexes `#FA5843`, `#4FC3F7`, `#B388FF`, `#4ADE9B`. The concept console's QA checklist becomes a lint rule.
3. **`one-primary-per-view`** — warns when a route renders more than one `<Button variant="primary">`. This is the machine-checkable form of the 10% coral rule.

### 13.7 Scaffolding order for Phase 4

The dependency order, so tasks can be sequenced without discovery:

1. `tokens.primitives.css` + `tokens.semantic.css` + `build-tokens.ts` + `contrast.test.ts` — nothing renders correctly before this, and the contrast test is the gate that proves the palette work in §4 landed.
2. `globals.css` + Tailwind `@theme` + the font setup.
3. `core/shared/src/status.ts`.
4. shadcn init + the primitive set: `button card badge dialog drawer sheet tabs table command popover tooltip select checkbox form input textarea separator skeleton toast accordion scroll-area`.
5. The MCPForge chip family (`StatusChip`, `BindingChip`, `PackageChip`, `VerbChip`, `ChangeStateChip`, `ProbeStatusChip`, `EnvChip`) — all driven by `status.ts`.
6. The app shell: sidebar with three collapsible groups + icon rail, topbar with the environment/branch/persona/density/theme controls, the change tray.
7. `DataTable` (TanStack) + `FacetPanel`.
8. The command palette.
9. The write-path family (§7.6).
10. Pages, in Wave 0 order: Catalog → Build → Approvals → Activity → Environments → Home → Requests → Governance → Insights.

---

## 14. Judgment calls the user should sanity-check

Seven. Each names what changes if the user disagrees.

1. **Component library: shadcn/ui + Tailwind v4, vendored.** *If ARIA, MORPHED or DEXA ship a house React component library or design system package, that wins and §3 is revised* — the alignment argument beats every technical advantage listed. Changing this changes §3 and §13.3 and nothing else structural, because everything else is expressed in CSS custom properties.
2. **Typography: serif kept for display only; Inter for UI; the Office-safe Cambria/Calibri constraint dropped.** The concept console needed a self-contained file; the portal does not. If the LTM brand mandates Calibri for body text in products, this is a one-token change — but Calibri at 12.5px in a dense grid is materially worse than Inter, and that is the trade being made.
3. **`--status-danger` is an alias of the coral ramp rather than a new red hue.** Two nearly-identical reds with different meanings is worse than one red used carefully, and danger is distinguished by treatment (chip/banner + glyph + word), never hue alone. If the user wants a distinct danger red, it is a one-line token change with no component churn.
4. **The narrative pages are removed from the portal.** Overview, Why this / why now, Live Walkthrough and Plan & Decisions do not appear; Architecture becomes documentation at `/docs/architecture`, linked contextually rather than navigated to. This is the biggest single departure from the concept console's IA. **If the portal is also expected to serve as the demo artefact**, this is wrong and those pages come back as a fourth `SHOW` group — but the honest recommendation is to keep the demo in the console and the deck, and keep the product a product.
5. **Nine top-level destinations, with Approvals split out from Governance.** More than most consoles carry. The alternative is seven with Approvals as a Governance tab and Insights folded into Environments — defensible, and it makes the approval queue (the thing a Wave-0 admin lives in) one click further away. The split is recommended precisely because Wave 0 is write-heavy.
6. **Density defaults to `comfortable`, not `compact`.** An Oracle-console audience may well expect compact by default. It is a one-line default change; the mechanism supports both from day one.
7. **The command palette is backed by the same `forge.find` index as the agents, with no portal-only search.** This is the strongest coupling decision in the document. It means a portal search regression and an agent discovery regression are the same bug, caught by the same benchmark. The cost is that portal search cannot be tuned independently for human ergonomics. **This is deliberate and it is the recommendation** — but it is worth a sanity-check, because it is the decision most likely to be questioned by someone who wants the portal search to "just be better."

**And one consequence, not a judgment call:** the write path (§7) is roughly a third of the portal's component work, and it is Wave 0 scope in full — plan card, confirm variants, approval gate, execution result, reversal, and six distinct refusal states. Phase 1 §10.5 item 7 named this; §7.6 is the component list that prices it. **If portal scope has to be trimmed in Wave 0, trim Insights and Home, never the write path** — the same logic Phase 1 applied to trimming read tools rather than write tools.

---

## 15. Handoff to Phase 4

What is now settled enough to become tasks without further design judgment:

- **Token files and their build/verify gate** — §13.1, §13.2, §13.4, §13.7. The scaffolding order in §13.7 is a literal task sequence.
- **Component library and the exact shadcn primitive list** — §3, §13.7 step 4.
- **Nine routes with their data sources, contents and empty states** — §5.3.
- **The write-path component family, named** — §7.6, with its state machine in §7.1 and its per-state visual requirements in §7.2–§7.5. This is Wave 0's largest UX build and it should be sequenced **with** the write-safety machinery, not after it, so the plan strings and refusal shapes are exercised by a human as they are implemented.
- **The change model's states, vocabulary and three-diff rule** — §6. The "Save means Propose" vocabulary is a review checklist item, not a preference.
- **Two discovery surfaces** — §9 (palette, with its grammar, latency budget and result contract) and §10 (agent copy standards, which are **codegen gates**, and the Agent-view screen).
- **Environment and data-class indicators** — §11, driven by a single gateway API field so the SQLite→Postgres migration needs no redesign.
- **Five accessibility CI gates** — §12.7, which may not be marked allowed-to-fail.

**What Phase 4 must decide that this document deliberately does not:** the build sequence *within* the portal relative to the gateway (§13.7 gives the internal order, not where the portal sits against the rest of Wave 0 — though Phase 2 §8.2 already places the portal last in the Wave 0 order, and §14's closing note argues the write-path components should be pulled earlier than that implies); which portal tasks are autonomous versus human-reviewed; and how the intervention log categorises a UI defect (a suggestion: by which of §13.6's lint rules or §12.7's gates would have caught it, since that is the fastest route from a defect to a spec improvement).

**Open items this document adds to the programme's list:**
- Whether an LTM house component library exists (§3.3, §14 item 1). This is a question for the user and it should be asked before the portal scaffolding task starts, not after.
- The `?` keyboard shortcut sheet's content, which cannot be finalised until the routes exist.
- Whether the portal ships with a customer slice — **untouched here.** It is D1 sub-question 2 and remains open. §5.3's Packages tab presents the mechanism without implying an answer, exactly as the concept console does.

---

## 16. Correction applied by Phase 5, per user direction, 27 Aug 2026 — the consumer surfaces

### 16.1 The IA decision and its rule

**Decision: no new top-level route.** Phase 3's own criterion for splitting Approvals out of Governance (§5.1 item 2) is *"an approval queue is a place you live and governance configuration is a place you visit."* Applying that rule rather than inventing one:

> **Governance is where a consumer's authorization is decided. Activity is where its behaviour is observed. Registration is a grant; usage is an event.**

This mirrors the definitional/runtime and git/store split the whole document already runs on — it is the right seam rather than a convenient one.

### 16.2 Governance → Consumers (tab 5)

*Admin · reads git (the record) + gw (credential age and usage) · follows the Roles tab's pattern exactly.*

- **The registered-consumer table**: id, label, class, owner, steward, status, expiry, credential age, next rotation due.
- **The detail editor**, in the Roles-tab style: edit on the left, **the compiled authorization artefact rendered explicitly on the right**, and nothing saves directly — every change produces a change proposal whose diff is the compiled artefact. A consumer editor that hides what a consumer may actually reach is the same failure 02 §8.1 item 4 names for the role editor, and it gets the same treatment.
- **The elevated-grant panel**: each `bindingGrant` with its standing authorization, approver and expiry — chipped `--status-write` within 30 days of expiry, `--status-danger` past it.
- **Actions**: Register / Suspend / Rotate credential / Retire. All produce change proposals **except Suspend**, which is a kill-switch act — immediate, audited, reason required. **Type-to-confirm on Suspend at deployment scope and on Retire**, per §7.3's friction ladder.

### 16.3 Activity → Consumers (`/activity/consumers`)

Per-consumer usage over time; quota headroom as a meter against declared limits; the detector table with each detector's state, threshold and last fire; the anomaly-event list, each linking into the audit calls that triggered it; and the same staleness marker discipline as §11.4 (this is polled runtime data, not streamed).

### 16.4 Small additions to existing surfaces

- **Approvals** — the three new definitional approval kinds (registration, rotation, standing authorization), differentiated by chip only.
- **Home → "What broke"** — open critical anomaly events. One list item, no new component.
- **Catalog tool detail → Binding & handshake** — a **"Who may execute this"** block naming the roles and consumers holding an elevated grant with their expiry, because the section currently answers *how* the binding authenticates and not *who* may fire it.
- **Command palette** — the `no_tool`-style treatment for a `requires_grant` result, with a primary action "Request this grant" that opens Requests pre-filled — reusing §9.2 item 5's existing pattern.

### 16.5 New chip values

`ConsumerStatusChip` (active / suspended / expired / retired) and `GrantStateChip` (granted / standing-authorized / expiring / expired / not granted), both driven by `status.ts` per §13.5, both with a visible text label and an accessible name that expands the abbreviation per §12.5. **No new colour tokens** — reuse `--status-ok` / `--status-write` / `--status-danger` / `--status-neutral`. Phase 5 introduces no palette change and the §4.6 contrast measurements are untouched.

### 16.6 Copy standards for the new refusals

Extend §10.3's table with four rows — the agent-facing `next` strings for the four new error codes:

| Error code | Agent-facing `next` |
|---|---|
| `CONSUMER_UNREGISTERED` | *"Register this client via the portal's Consumers registration flow before retrying; see the operator for onboarding."* |
| `CONSUMER_SUSPENDED` | *"This client's registration is suspended. Contact the named steward to resolve, or wait for reinstatement."* |
| `CONSUMER_NOT_AUTHORIZED` | *"Your client is not authorized for this binding type / sensitivity / write. Request a broader consumer authorization from its owner, not a role change."* |
| `ELEVATED_GRANT_REQUIRED` | *"This tool requires an elevated binding grant. Request it from the named approver; it is not covered by role scope alone."* |

The rule that makes §5.5's risk 6 concrete: **`CONSUMER_NOT_AUTHORIZED` names the client and says what the client may not do; `TOOL_NOT_IN_SCOPE` names the role and says what the person may not do. Never the same sentence, never interchangeable.**

### 16.7 Accessibility

No new gates. The five in §12.7 cover the new surfaces; the keyboard-only Playwright script in gate 4 gains the consumer-suspend and grant-renewal flows.

### 16.8 Trim order

Restating `05` §5.6's ranked order: **`W0-J20` Insights → `W0-J19` Home → `W0-N13` Activity → Consumers. Never** the write path, **never** Governance → Consumers, **never** the policy-chain or secrets tasks. Governance → Consumers outranks Insights because Insights charts metrics that are already CI-gated, while Governance → Consumers is the only place a governance owner can see who is connected and what they may reach, with no CI gate substituting for it.

*Correction applied by Phase 5, per user direction, 27 Aug 2026.*

---

*MCPForge · BlueVerse ValueMesh · LTM Oracle AI Practice. Phase 3 of 4 — UX / UI design system. Companion to `01_GOALS_AND_ROADMAP.md` and `02_TECHNICAL_ARCHITECTURE.md`; supersedes nothing in either. The concept-console build spec remains authoritative for the demo artefact only.*
