---
status: accepted
---

# Keep Tauri Adapters in src/ipc

All frontend `invoke` calls and Rust command payload translations live in `src/ipc/*`. This Seam keeps command names, serialization conventions, and Tauri coupling out of Workflows and page Surfaces, allowing browser development adapters and pure Module tests to exercise application behavior without a desktop runtime.

## Consequences

A new Rust command requires a typed Adapter in `src/ipc/*`; callers use that Interface instead of importing `@tauri-apps/api/core` or assembling snake_case command payloads themselves.
