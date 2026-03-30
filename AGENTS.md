# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Overview

drop is a LAN inbox server built with Bun. It exposes a mobile-friendly web UI and REST API that lets any device on the local network drop files, text, and clipboard content into a filesystem inbox (`~/.drop/inbox/` by default). Designed for feeding content to coding agents via filesystem paths.

## Commands

```bash
bun install          # Install dependencies (only @types/bun)
bun start            # Run the server
bun dev              # Run with --watch (auto-reload on changes)
bun test             # Run all tests
bun test src/__tests__/storage.test.ts   # Run a single test file
```

No build, lint, or compile step. TypeScript runs directly via Bun.

## Architecture

```
src/
  index.ts        Entry point. Starts server, auto-increments port on EADDRINUSE, prints LAN/local URLs.
  server.ts       Bun.serve HTTP server. All routing is manual (no framework). Serves API + frontend HTML.
  storage.ts      Filesystem-backed store. No database -- metadata is derived from filenames and stat().
  frontend.html   Single-file SPA (inline CSS/JS). No build step, served as-is.
  __tests__/      Bun test files. Server tests use port 0 (random) with temp directories.
```

### Key design patterns

- **Filename-as-schema**: Item type is encoded in the filename (`-snippet.txt` = text, `-clipboard` = clipboard, everything else = file). Item metadata is reconstructed from filenames + `stat()` on `listItems()`.
- **Lazy GC**: `autoCleanup()` runs on every HTTP request (inside `fetch()`), not on a timer. Deletes items older than 24 hours.
- **Zero dependencies**: No Express, no ORM, no file upload library. Uses `Bun.serve`, `Bun.write`, `Bun.file`, `FormData` parsing built into Bun.
- **Path traversal defense**: `sanitize()` strips non-alphanumeric chars from filenames. `deleteItem()` applies `basename()` before joining paths.

### Server routing

All routes are defined in `server.ts` as sequential `if` checks on method + pathname. There is no router abstraction. API routes are under `/api/*`, raw file serving under `/raw/:id`, and the frontend is served at `/`.

### Store API

`Store` class in `storage.ts` is the sole data layer. Constructor takes optional `inboxDir` (defaults to `$HOME/.drop/inbox` or `$DROP_DIR`). Methods: `saveFile`, `saveText`, `listItems`, `deleteItem`, `clearAll`, `autoCleanup`. Each returns a `DropItem` with `id`, `filename`, `path`, `type`, `size`, `createdAt`.

## Configuration

Environment variables (no config files):
- `DROP_PORT` -- server port (default `3939`, auto-increments on conflict)
- `DROP_DIR` -- inbox directory (default `~/.drop/inbox`)
- `HOME` -- required fallback if `DROP_DIR` is unset; missing HOME throws at construction time

## Testing

Tests use `bun:test` with temp directories (`mkdtempSync`) created per test and cleaned up in `afterEach`. Server tests bind to port 0 for automatic port allocation. No mocking framework -- `Store` is concrete and testable in isolation.
