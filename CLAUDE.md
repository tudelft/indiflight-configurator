# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Indiflight Configurator is a crossplatform desktop application for configuring the Indiflight flight controller (a fork of Betaflight). It connects to flight controllers over serial/USB using MSP (Multiwii Serial Protocol) to read and write configuration. Built with NW.js (desktop), Cordova (Android), jQuery, and Vue.js 2.

## Common Commands

```bash
yarn install                  # Install dependencies
yarn start                    # Dev mode with Vue devtools (NW.js + hot reload)
yarn gulp debug               # Debug build (output in ./debug/)
yarn release                  # Production release build (output in ./release/)
yarn test                     # Run tests (Vitest, runs lint first via pretest)
yarn lint                     # ESLint check
yarn lint:fix                 # ESLint auto-fix
yarn storybook                # Vue component development UI
```

Build platform flags for gulp: `--win64`, `--linux64`, `--osx64`, `--android`, `--armv8`.

## Architecture

**Entry points:**
- `src/main.html` + `src/js/main.js` — NW.js desktop app entry
- `src/main_cordova.html` + `src/js/main_cordova.js` — Cordova/Android entry

**Tab system:** Each configurator screen is a tab module in `src/js/tabs/` with corresponding HTML in `src/tabs/`. Tabs are loaded conditionally based on connection state and firmware API version. The `indi.js` tab is Indiflight-specific (INDI attitude controller tuning).

**MSP protocol layer:**
- `src/js/msp.js` — MSP v1/v2 frame encoding/decoding with XOR checksums
- `src/js/msp/MSPCodes.js` — Command code constants
- `src/js/msp/MSPHelper.js` — High-level read/write helpers that pack/unpack FC config
- `src/js/msp/MSPConnector.js` — Connection management

**Serial communication:** `src/js/serial.js` and `src/js/serial_backend.js` handle port enumeration, USB device filtering, and data I/O. `src/js/port_handler.js` manages port lifecycle.

**State:** `src/js/fc.js` holds flight controller state/config. `ConfigStorage` wraps localStorage for persistence. No Vuex — state is managed via globals and the FC object.

**Vue components:** `src/components/` contains Vue 2 SFCs (e.g., motor reordering, status bar, quad status). Registered in `src/components/init.js`.

**Build system:** Gulp (`gulpfile.js`) orchestrates Rollup bundling, LESS compilation, NW.js packaging, and platform-specific installers (InnoSetup for Windows, deb/rpm for Linux, appdmg for macOS).

## Code Conventions

- 4-space indentation, Unix line endings
- ES Modules (`import`/`export`) in `src/`; CommonJS (`require`) in build scripts
- `const`/`let` only (no `var`), prefer template strings, trailing comma in multiline
- jQuery (`$`) used extensively alongside Vue 2 components
- Localization via i18next — translation files in `locales/`

## Testing

- Vitest with jsdom environment
- Tests in `test/js/*.test.js`
- Setup in `test/setup.js`
- Run a single test file: `npx vitest run test/js/msp.test.js`
