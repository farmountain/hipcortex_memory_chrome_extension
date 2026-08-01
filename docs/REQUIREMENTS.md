# Layer 1 — Requirement Intelligence

## Product Vision
Give every browser user and every AI agent that lives in the browser a persistent, causal, local-first memory substrate (HipCortex) without leaving the tab.

## Inputs Consumed
- HipCortex product vision & existing REST surface
- Chrome Extension Manifest V3 constraints
- Existing VS Code extension patterns (chat participant, LM tools)
- Security policies (no remote code, least privilege, dual health)
- Coding standards (TypeScript strict, modular)

## Requirement Graph (high level)

### R1 — Connectivity
- R1.1 Must detect local server at configurable URL (default 127.0.0.1:3030)
- R1.2 Must support dual /health response formats (plain “ok” + JSON)
- R1.3 Must tolerate multiple historical endpoint paths for add/search

### R2 — Capture
- R2.1 User can add free-text memory from popup / side panel
- R2.2 Context menu on selection → add as memory with page URL/title metadata
- R2.3 Keyboard shortcut for selected text
- R2.4 Default actor is configurable

### R3 — Retrieval
- R3.1 Search from popup and side panel
- R3.2 Context menu “search selection” opens side panel with query pre-filled

### R4 — UX Surfaces
- R4.1 Action popup
- R4.2 Side panel
- R4.3 Options page
- R4.4 Context menus
- R4.5 Commands

### R5 — Security & Privacy
- R5.1 Manifest V3 only
- R5.2 Host permissions limited to HipCortex origins by default
- R5.3 Optional host permissions for AI chat sites (future injection)
- R5.4 No remote code execution
- R5.5 Settings in chrome.storage.sync

### R6 — Quality Gates
- R6.1 TypeScript strict
- R6.2 Build produces loadable unpacked extension
- R6.3 Predictive failure handling for network / 404 / timeout

## Acceptance Criteria (MVP)
1. Load unpacked → popup shows “online” when hipcortex start is healthy
2. Add memory from popup → appears in subsequent search (or at least returns success)
3. Select text on any page → context menu → memory stored with URL metadata
4. Options page can change API URL and test connection
5. Side panel opens via keyboard shortcut and can search

## Unknown Assumptions (flagged for future Reality Model)
- Exact current REST paths may still evolve (client already multi-endpoint)
- Whether /memory/add vs /memory/ingest is canonical
- Future need for auth beyond optional API key
