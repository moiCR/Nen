# Nen

## Project

- Nen is a modern, ultra-fast file explorer for Windows (inspired by File Pilot) built with Tauri v2, Rust (backend core), and React 19 / TypeScript / Tailwind CSS v4 (frontend).
- Prioritize maintainability, readability, performance, zero-latency responsiveness, and correctness over clever optimizations.
- Preserve the project's minimal, keyboard-driven UI philosophy.

## Rust (Backend - `src-tauri`)

- Write idiomatic Rust (edition 2024).
- Never use `unwrap()`, `expect()`, or other panicking APIs in production code.
- Propagate errors using `Result` and `?`. Return serializable error types or formatted error strings in all `#[tauri::command]` functions so errors bubble up safely to the frontend.
- Avoid unnecessary cloning and allocations in hot loops, IPC serialization, and file traversal.
- Prefer descriptive names over abbreviations.
- Keep functions focused on a single responsibility.
- **Always use early returns (`if ... return` / `continue`) and guard clauses instead of `if / else` blocks.** Avoid `else` branches.
- Run `cargo fmt` before finishing changes.
- Keep `cargo clippy` free of warnings.
- Don't write comments in the code. If strictly necessary, comments should explain **why**, never **what**.
- Remove dead code instead of commenting it out.
- Avoid TODOs unless explicitly requested.

## Frontend (React 19 & TypeScript - `src`)

- Write strict, type-safe TypeScript (`noImplicitAny`, avoid `any`; use typed interfaces, discriminated unions, or `unknown` with type narrowing).
- **Always use early returns (`if ... return` / `continue`) and guard clauses instead of `if / else` blocks.** Avoid `else` branches.
- **Keep `import` statements compact on a single line** (or minimal lines only if super long). Never split every imported item onto its own vertical line.
- **`render` Must Be Pure & Side-Effect Free**:
  - Keep rendering declarative. Never run business logic, IPC invokes, or state mutations inside component render bodies.
  - PROHIBITED inside render bodies: direct `invoke()`, side-effecting window manipulation, or unbounded state setters.
- **State Management & Data Fetching**:
  - Use TanStack Query (`@tanstack/react-query`) for asynchronous server / Tauri state (filesystem reads, directory listings, metadata, search queries). Leverage query keys, caching, and cache invalidation.
  - Use TanStack Router (`@tanstack/react-router`) for navigation, active path state, and URL/search parameters.
  - Store ephemeral UI state (e.g. input focus, selection cursor) in local React state or lightweight state hooks; avoid duplicate sources of truth.
- **Virtualization & UI Performance**:
  - Directory contents, search results, and large file listings MUST be virtualized (e.g., `@tanstack/react-virtual`). Never instantiate DOM nodes for thousands of files at once.
  - Every interactive element and list item rendered inside an iterator or loop MUST be given a unique, stable `key` (e.g., the canonical file path).
  - Avoid unnecessary re-renders: memoize heavy calculations with `useMemo`, stabilize callbacks with `useCallback` when passed down virtual trees, and debounce rapid input streams (e.g., search queries).
- **Keyboard-First & UX**:
  - Maintain keyboard-first interaction across all screens: instant response to arrow navigation, shortcuts, and command palettes.
  - Clean up event listeners, timers, and Tauri event subscriptions (`unlisten()`) on component unmount to prevent memory leaks.
- Reuse UI components whenever practical.

## Architecture & Tauri IPC Separation

- Prefer extending existing modules before creating new ones.
- Do not create new crates or modules unless there is a clear architectural reason.
- Keep related functionality together.
- Avoid introducing traits unless multiple implementations are expected.
- Favor composition over unnecessary abstractions.
- **Tokio & Asynchronous Backend**:
  - Tauri commands execute asynchronously on Tokio runtime worker threads.
  - All disk I/O, file system scanning (`jwalk`, `std::fs`), file watching (`notify`), Windows Shell / COM interactions (`windows` crate), and search indexing MUST NOT block the async runtime thread.
  - Offload heavy CPU or synchronous blocking file I/O to `tokio::task::spawn_blocking` or dedicated background tasks.
- **IPC Boundary & Streaming**:
  - IPC serialization across the webview boundary (`invoke`) has a performance cost. Avoid repeatedly passing large un-paged payloads.
  - For large directory scanning or real-time search progress, stream results progressively using Tauri events (`app_handle.emit`), ingested in React via `@tauri-apps/api/event` listeners or TanStack Query invalidation.

## Windows & File System Conventions

- **File System & Process Churn**:
  - UI interactions, modal openings, tab switching, and search queries must NEVER trigger un-cached synchronous disk re-scans.
  - Directory changes must be monitored reactively using background watchers (`notify` in Rust), emitting events to the frontend to invalidate TanStack Query caches.
- **Shell & File Operations**:
  - File deletions must prioritize the Windows Recycle Bin (`trash` crate / Windows Shell API) over permanent deletion.
  - Launching files with default system applications must be asynchronous and non-blocking (`tauri-plugin-opener` or `open` / `ShellExecuteW`).
  - Gracefully handle Windows path quirks: drive letters (`C:\`), UNC paths (`\\server\share`), long path prefixes (`\\?\`), and case insensitivity.
- **Icons & Metadata**:
  - Load system file icons and thumbnails asynchronously with caching (Rust backend extracting HICON/SHGetFileInfo, cached and served via custom protocol or Base64 / asset protocol); never block directory rendering or Tauri commands waiting for shell icon extraction.

## Codebase Structure

```
├── src/                          # Frontend (React 19 + TypeScript + Vite + Tailwind v4)
│   ├── assets/                   # Fonts (Geist) and SVG icons
│   ├── components/               # Reusable UI components (titlebar, sidebar, virtual lists, inputs)
│   ├── routes/                   # TanStack Router file-based routes (__root.tsx, index.tsx, etc.)
│   ├── hooks/                    # Custom React hooks (keyboard shortcuts, Tauri event subscriptions)
│   ├── lib/                      # Tauri IPC wrappers, query client, utilities
│   ├── types/                    # Shared TypeScript interfaces & IPC payload types
│   ├── App.css                   # Tailwind v4 styles, theme variables, custom scrollbars
│   └── main.tsx                  # Application bootstrap, router, and query provider
├── src-tauri/                    # Backend (Rust Tauri v2)
│   ├── src/
│   │   ├── commands/             # Tauri IPC commands (fs, shell, search, watcher)
│   │   ├── services/             # Background services (file scanner, watcher, icon cache)
│   │   ├── state/                # Tauri managed app state
│   │   ├── lib.rs                # App setup, plugins, command registration
│   │   └── main.rs               # Desktop binary entry point
│   ├── capabilities/             # Tauri v2 security & permission capabilities
│   ├── Cargo.toml                # Rust crate configuration & dependencies
│   └── tauri.conf.json           # Window and build configuration
```

## Multiple Instances & Global State

- Avoid creating multiple instances of a single object.
- **Backend**: Instantiate managers, watchers, or application states once, register them via `app.manage(...)`, and access them in commands via `tauri::State<'_, AppState>`.
- **Frontend**: Configure single instances of `QueryClient` and `Router` once at the root (`main.tsx`). Do not instantiate multiple query clients or router contexts across subcomponents.

## Scope

- Only implement what was requested.
- Do not add features, configuration options, or dependencies unless explicitly required.
- Avoid speculative abstractions.
- Do not make unrelated refactors while implementing a feature.
