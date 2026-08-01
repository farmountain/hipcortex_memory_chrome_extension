# HipCortex Chrome Extension

**Persistent causal memory for the browser.**

This is the first product of **THE AI SOFTWARE FACTORY** (Prompt Operating System).

> **One prompt → Reliable end-to-end delivery** with self-verification and continuous quality gates.

## Alignment with the AI Software Factory Infographic

| # | Factory Principle | How this repo embodies it |
|---|-------------------|---------------------------|
| **1** | **From Linear Prompts to Prompt OS** | Not a one-shot “write me an extension” prompt. Built as a multi-layered system with explicit requirements, abstractions, and quality gates. |
| **2** | **Reason over Abstractionsions, not Tokens** | Reality Model via typed `MemoryRecord`, knowledge of HipCortex endpoints + Manifest V3 constraints, and modular structure (types → client → background → UI) instead of raw token generation. |
| **3** | **Orchestrate a Multi-Agent Factory** | Separation of concerns treated as specialist roles: API specialist (client), Architect (background router), Frontend (popup/sidepanel), Security (least-privilege permissions + no remote code). |
| **4** | **The Self-Repairing Harness Loop** | Resilient multi-endpoint discovery, dual `/health` handling, timeouts, badge feedback, and structure ready for automated tests/scans → quality gates → repair. |
| **5** | **Predictive Failure Engineering** | Client anticipates endpoint drift, network failure, auth issues, and schema mismatches and maps them to automatic fallback strategies. |

### Detailed 11-Layer Mapping (original design)

| Layer | Realization in this repo |
|-------|--------------------------|
| 1. Requirement Intelligence | `docs/REQUIREMENTS.md` + OpenSpec-style acceptance criteria |
| 2. Reality Context | Explicit knowledge of Manifest V3, HipCortex HTTP/MCP surface, Chrome APIs |
| 3. Abstraction Syntax Tree | Typed modules: types → API client → background → UI controllers |
| 4. Knowledge Graph | MemoryRecord ↔ Component ↔ Permission ↔ Test links |
| 5. Planning Engine | Hierarchical: Mission → MVP features → tasks |
| 6. Multi-Agent Factory | Clear separation of concerns (API specialist, UI, background, security) |
| 7. Harness Loop | TypeScript structure + future ESLint + Vitest + Manifest V3 validators |
| 8–9. Predictive Failure | Resilient multi-endpoint discovery, timeout guards, dual `/health` handling |
| 10. Superpowers | Chrome MV3 APIs, storage.sync, sidePanel, contextMenus, commands |
| 11. Continuous Learning | Settings + session storage as the beginning of project memory |

## Features (MVP)

- **Popup**: health indicator, quick-add memory, search
- **Side Panel**: richer search + capture (Ctrl/Cmd+Shift+H)
- **Context Menu**: “Add selection / page to HipCortex”, “Search selection”
- **Keyboard**: Ctrl/Cmd+Shift+M = quick-add current selection
- **Options page**: API URL, API key, default actor, feature flags
- **Resilient client**: tries multiple known HipCortex endpoint shapes
- **Local-first**: defaults to `http://127.0.0.1:3030`

## Prerequisites

1. HipCortex server running:
   ```bash
   pip install -U hipcortex
   hipcortex start
   ```
2. Chrome / Chromium / Edge (Manifest V3)

## Development

```bash
npm install
npm run build          # compiles TS → dist/ + copies assets
# Load unpacked extension: chrome://extensions → Developer mode → Load unpacked → select dist/
```

## Packaging

```bash
npm run package        # produces hipcortex-chrome-extension-v0.1.0.zip
```

## Architecture Notes

- **Service worker** (`background.ts`) is the single message router and context-menu host.
- **HipCortexClient** abstracts the HTTP surface and absorbs endpoint drift.
- All UI surfaces talk only via `chrome.runtime.sendMessage` (no direct network from content/popup except through background).
- Settings live in `chrome.storage.sync`.

## Roadmap (next factory iterations)

- [ ] Content scripts for ChatGPT / Claude / Gemini context injection
- [ ] Real icons + branding from HipCortex logo
- [ ] Vitest unit tests for client + message handlers
- [ ] ESLint + Prettier + Chrome extension linter in CI
- [ ] Graph visualization in side panel
- [ ] Optional WASM / offline semantic cache
- [ ] Integration with HipCortex MCP tools surface

## License

Apache-2.0 (aligned with HipCortex core)
