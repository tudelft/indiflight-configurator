---
description: "Vue 3 development standards for Betaflight Configurator, with enforcement-status ledger for migration phases."
applyTo: "**/*.vue, **/*.ts, **/*.js, **/*.scss, **/*.less"
---

# Vue 3 Development Instructions

Standards for AI-assisted contributions to Betaflight Configurator. Adapted from the [awesome-copilot Vue 3 instructions](https://github.com/github/awesome-copilot/blob/main/instructions/vuejs3.instructions.md), with project-specific adjustments and an enforcement ledger that tracks which rules are tooled and which remain guidance.

## Project context
- **Stack**: Vue 3 + Composition API + `<script setup>`, Pinia 3, Vite 7, Tauri 2 (desktop), Capacitor 8 (Android).
- **UI**: `@nuxt/ui` v4 components + Tailwind CSS v4. Not a Nuxt app — no SSR, no `useAsyncData`, no Nuxt auto-imports outside the UI library.
- **TypeScript**: incremental adoption. New files as `.ts` or `<script setup lang="ts">`; JSDoc on touched legacy JS. Full strict-mode rollout is a future phase.
- **Naming**: `PascalCase` for both component names and `.vue` file names.

## Enforcement ledger

A rule lives in this file **only when tooling cannot enforce it yet**. Each row has an enforcement target — when that tool lands, the row leaves the file.

Status legend: 🚧 guidance-only · 🔧 partially tooled · 📐 stays as guidance (taste call, not lintable).
Already enforced by ESLint / Prettier / EditorConfig (and intentionally absent below): indentation, semicolons, trailing commas, import order, basic naming.

### #4800 — Pinia as single source of truth

| Rule | Status | Enforcement target |
|---|---|---|
| No MSP calls from Vue components — wrap in a store action or composable | 🚧 | ESLint `no-restricted-imports`: ban `src/js/msp/**` from `src/components/**` (Phase 0) |
| Only `src/stores/**` and `src/composables/**` may import `src/js/msp/**` | 🚧 | `eslint-plugin-boundaries`, scoped per converted domain (Phase 1) |
| No new fields on `src/js/fc.js` — write to a Pinia store | 🚧 | Seal `fc.ts` interface once converted (Phase 2) |
| Hydration from legacy is explicit: `store.hydrateFromLegacy(…)` | 🚧 | TS store interface forces the method (Phase 1, per domain) |
| New MSP codes: `src/js/msp/MSPCodes.js` + encode/decode in `MSPHelper.js`, aligned with firmware `msp_protocol.h` | 🚧 | CI script diffing `MSPCodes.js` against `msp_protocol.h` (Phase 1) |

### #4995 — Nuxt UI v4 + Tailwind conversion

| Rule | Status | Enforcement target |
|---|---|---|
| Reach for `@nuxt/ui` v4 first: `UButton`, `UInput`, `UInputNumber`, `USelect`, `USwitch`, `UModal`, … | 📐 | Taste call |
| Use shared wrappers in `src/components/elements/`: `UiBox`, `SettingRow`, `SettingColumn`, `HelpIcon`, `WikiButton` | 📐 | Taste call |
| No new `<style scoped>` blocks; promote shared rules to `src/css/theme.css` or `nuxt-ui.css` | 🚧 | `eslint-plugin-vue` custom rule, scoped to converted tabs (Phase 1) |
| No hard-coded colors — theme via CSS custom properties | 🚧 | Stylelint `color-no-hex` + disallowed-value list (Phase 0) |
| Respect light/dark (`.dark`) and color themes (`data-theme`) | 📐 | Visual review |

### TypeScript migration (next phase)

| Rule | Status | Enforcement target |
|---|---|---|
| New files as `.ts` or `<script setup lang="ts">` | 🚧 | `tsconfig` `allowJs: false` on `src/components/**` (Phase 2) |
| Touched legacy JS gets JSDoc types | 🚧 | `eslint-plugin-jsdoc` on changed files (Phase 1) |
| Strict mode in converted folders | 🚧 | `tsconfig` `"strict": true` via per-folder overrides (Phase 2) |

### Always-on

| Rule | Status | Enforcement target |
|---|---|---|
| `.vue` filenames and component names: `PascalCase` | 🔧 | `eslint-plugin-unicorn/filename-case` (Phase 0) |
| Don't edit `dist/`, `node_modules/`, generated output | 🚧 | Pre-commit hook by path (Phase 0) |
| i18n source of truth is `locales/en/messages.json` (Crowdin syncs the rest) | 🚧 | Pre-commit hook rejecting non-`en` locale edits (Phase 0) |
| Tests for non-trivial behaviour (Vitest, `npm run test`) | 📐 | Coverage gate is a proxy; review call |
| Tests must catch bugs, not confirm the fix. A suite co-authored with the change is confirmation-biased — it passes while the code is still broken. Verify by driving the real behaviour (hardware/e2e), and write bug-hunting tests independently/adversarially, ideally blind to the implementation. | 📐 | Review call; separate adversarial pass |
| One concern per PR (one tab, one store, one TS file) | 📐 | PR template / reviewer call |
| Comments state non-obvious why (rationale) or what (functionality) concisely — no restating what well-named code shows, no personality/filler, skip it if removing wouldn't confuse a future reader. Before finishing, re-check new comments against this row | 📐 | Review call |

## Phase plan
- **Phase 0** — land cheap tooling: MSP-from-components ban, filename-case, Stylelint colors, pre-commit hooks for locales and generated paths.
- **Phase 1** — per-domain bundles: each TS or Nuxt UI conversion PR ships the boundary lint, scoped-style ban, JSDoc rule, and MSP CI script for that domain.
- **Phase 2** — once enough is TS: seal `fc.ts`, flip `allowJs: false` on converted folders, ratchet `strict: true`.

When a 🚧 row's target tool lands, delete the row. The file should shrink monotonically.

---

# Development standards (📐 guidance — not tooled)

The sections below are taste-call patterns that can't be reasonably linted. They're durable guidance; they don't shrink with phases.

## Architecture
- Favour the Composition API (`setup` functions and composables) over the Options API.
- Organise components and composables by feature or domain for scalability.
- Separate presentational components (UI-focused) from container components (logic-focused).
- Extract reusable logic into composables under `src/composables/`.
- Structure Pinia stores by domain, with clearly defined state, getters, and actions.

## TypeScript integration (forward-looking)
- New files: `.ts` or `<script setup lang="ts">` with `defineProps` / `defineEmits`.
- Use `PropType<T>` for typed props and default values.
- Define interfaces or type aliases for complex prop and state shapes.
- Type event handlers and refs; type store getters and actions explicitly.

## Component design
- Single responsibility per component; keep them small.
- `<script setup>` syntax is the default.
- Validate props with TypeScript; runtime checks only when crossing untrusted boundaries.
- Favour slots and scoped slots for flexible composition.

## State management
- Pinia for shared state (`defineStore`); `ref` / `reactive` for component-local state.
- `computed` for derived state — avoid duplicating shape across stores.
- Side effects (MSP, persistence, polling) live inside store actions, not components.

## Composition API patterns
- `watch` / `watchEffect` with explicit dependencies; clean up in the returned stop handle or `onUnmounted`.
- `provide` / `inject` sparingly — prefer Pinia for cross-tree state.
- Plain `fetch` with reactive state for HTTP, or a project-internal composable. `useAsyncData` is Nuxt-only and not available.

## Styling
- Prefer Tailwind v4 utilities + `@nuxt/ui` v4 components over custom CSS.
- `<style scoped>` is acceptable in legacy SFCs; new components should avoid it (see #4995).
- Theme via CSS custom properties in `src/css/theme.css`. No hex literals in new code.
- Mobile-first responsive layouts. Respect `.dark` and `data-theme` switching.

## Performance
- Lazy-load heavy components with `defineAsyncComponent`; wrap with `<Suspense>` where appropriate.
- `v-once` and `v-memo` for static or rarely-changing subtrees.
- Avoid unnecessary watchers — prefer `computed`.
- Profile with Vue DevTools before micro-optimising.

## Data fetching
- Handle loading, error, and success states explicitly.
- Cancel stale requests on component unmount or param change.
- Cache where it pays off; revalidate in the background.

## Error handling
- Use `app.config.errorHandler` for uncaught errors.
- `errorCaptured` for component-local boundaries.
- Wrap risky logic in `try` / `catch` with user-friendly messages.

## Forms and validation
- Controlled `v-model` bindings; validate on blur or debounced input.
- Use a validation composable or library when forms grow non-trivial.
- Accessible labelling, error announcements, and focus management.

## Testing
- Vitest + Vue Test Utils. Test behaviour, not implementation.
- Mock global plugins (router, Pinia) as needed.
- Add tests next to non-trivial behaviour changes.

## Security
- Avoid `v-html`; sanitise any HTML input rigorously.
- Validate and escape data in templates.
- HTTPS for all network requests; never store sensitive tokens in `localStorage`.

## Accessibility
- Semantic HTML + ARIA attributes where semantics aren't sufficient.
- Manage focus for modals and dynamic content.
- Keyboard navigation for all interactive components.
- Meaningful `alt` text; color contrast meeting WCAG AA.

## Common patterns
- Renderless components and scoped slots for flexible UI.
- Compound components via `provide` / `inject`.
- Custom directives for cross-cutting concerns.
- `Teleport` for modals and overlays.

---

# Indiflight specifics

Project facts that aren't obvious from the code. The ledger rules above don't apply to them.

## Local build daemon and simulation
- Both the firmware flasher's "Local build" panel and the Simulation tab use `start.py`, which
  lives in the firmware repo (`../indiflight`; it listens on `127.0.0.1:8742` by default). The API lives there.
  `src/js/indiflight/localBuilderClient.js` is the only client.
- `src/stores/localBuild.js` owns the connection (url, token, `client`, `info`, config lists).
  `src/stores/simulation.js` reuses that connection. A setup store exposes only what it
  returns, so anything another store needs has to be in the return object.
- Builds and sims are both jobs with the same ids and the same `/api/builds/<id>` routes
  (summary, SSE events, cancel, artifacts). `kind` tells them apart. Each store must only
  attach to `info.activeJob` of its own `info.activeJobKind`. Final states are
  `success | failed | cancelled | stopped`.
- `BuildConfigPreview.vue` takes a `source` store (the local build store by default).
  `DaemonConnection.vue` is the shared URL/token/status block.
- Sim scripts and the SIL container contract are documented in
  `../indiflight/support/simulation/AGENTS.md`. Daemon changes need a matching commit in the firmware repo.

## Adding a tab
Add it to `src/components/sidebar/sidebar_items.js` and `src/js/vue_tab_registry.js`.
Add it to the allowed-tab lists in `src/js/gui.js`: both lists for `mode: "shared"`.
Add its `tab*` label in `locales/en/messages.json`. To switch tabs from code, call
`switchTab(key, { mode })` from `src/js/tab_switch.js`. To hand a log to the viewer, call
`openLogInBlackboxViewer()` in `src/blackbox-viewer/vue_init.js`.

## Release
- The web version is the annotated tag `web-vX.Y.Z` (`git tag -a web-vX.Y.Z -m web-vX.Y.Z`).
  `vite.config.js` reads it for the footer.
- Pushing the tag runs `.github/workflows/deploy-web.yml`, a production deploy that takes about
  20 minutes.
- `gh` resolves to the betaflight upstream by default. Pass `-R tudelft/indiflight-configurator`.

## Driving the app for verification
- Run `npm run dev`, which serves `http://localhost:8080`. The project has no Playwright, so
  install `playwright-core` into a scratch dir and launch the system Chromium:
  `chromium.launch({ executablePath: "/snap/bin/chromium", args: ["--no-sandbox"] })`.
- A fresh profile opens the Options dialog on load. Press Escape before clicking anything.
- Scope selectors to the tab (`.tab-<key>`), because the sidebar has its own Connect buttons.
