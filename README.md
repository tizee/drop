# drop

A lightweight LAN inbox for getting files and text onto your dev machine from any device on the same network. Built with [Bun](https://bun.sh/).

Run it on your laptop, open the LAN URL on your phone, and drop files, text snippets, or clipboard content straight into an inbox directory on disk. Each item gets a filesystem path you can copy and feed to coding agents or use however you like.

## What it does

- Serves a mobile-friendly web UI on `0.0.0.0:3939` (configurable)
- Accepts file uploads, text snippets, and clipboard content (text or images) via a REST API
- Saves everything to `~/.drop/inbox/` with timestamped filenames
- Auto-cleans items older than 24 hours
- Shows the full filesystem path for each item so you can copy it to agents or scripts

## Quick start

```bash
bun install
bun start            # foreground mode
```

Output:

```
  drop - LAN inbox for coding agents

  Local:   http://localhost:3939
  LAN:     http://192.168.x.x:3939
  Inbox:   /home/you/.drop/inbox

  Open the LAN URL on your phone to start dropping files.
```

## CLI (service management)

The `drop` CLI manages the server as a background process with a PID file at `~/.drop/drop.pid`.

```bash
# Start / stop / check
bun run drop start                  # start in background
bun run drop start --port 4000      # custom port
bun run drop start --dir ~/inbox    # custom inbox directory
bun run drop stop                   # stop the background server
bun run drop status                 # check if running

# View server logs
bun run drop log                    # last 20 lines
bun run drop log --lines 50         # last 50 lines
```

To install `drop` as a global command:

```bash
npm link          # creates a global symlink to this directory
drop start        # now available everywhere
```

> Note: `bun install -g` only supports registry packages, not local directories. `npm link` is the standard way to register a local package's bin as a global CLI command. It symlinks `src/cli.ts` (which has a `#!/usr/bin/env bun` shebang) into your global bin directory, so the CLI still runs via Bun.

To uninstall:

```bash
npm unlink -g drop
```

| Command | Description |
|---------|-------------|
| `drop start` | Start server in background, write PID to `~/.drop/drop.pid` |
| `drop stop` | Stop the background server |
| `drop status` | Check if the server is running |
| `drop log` | Show recent server log output (`~/.drop/drop.log`) |

| Flag | Applies to | Description |
|------|-----------|-------------|
| `--port <port>` | `start` | Override server port (default: 3939) |
| `--dir <path>` | `start` | Override inbox directory (default: `~/.drop/inbox`) |
| `--lines <n>` | `log` | Number of log lines to show (default: 20) |

### Development

For foreground mode with auto-reload:

```bash
bun dev
```

## Configuration

| Env var    | Default            | Description                        |
|------------|--------------------|------------------------------------|
| `DROP_PORT`| `3939`             | Server port (auto-increments if in use) |
| `DROP_DIR` | `~/.drop/inbox`    | Inbox directory on disk            |

## API

| Method  | Endpoint            | Description                  |
|---------|---------------------|------------------------------|
| `POST`  | `/api/upload`       | Upload a file (multipart)    |
| `POST`  | `/api/text`         | Save a text snippet (JSON)   |
| `POST`  | `/api/clipboard`    | Save clipboard content (text or image) |
| `GET`   | `/api/items`        | List all inbox items         |
| `DELETE`| `/api/items/:id`    | Delete a single item         |
| `DELETE`| `/api/items`        | Clear all items              |
| `GET`   | `/raw/:id`          | Serve raw file content       |
| `GET`   | `/`                 | Web UI (single-page HTML)    |

### Examples

Upload a file:

```bash
curl -F "file=@screenshot.png" http://localhost:3939/api/upload
```

Send text:

```bash
curl -H "Content-Type: application/json" \
     -d '{"text":"hello from the terminal"}' \
     http://localhost:3939/api/text
```

List items:

```bash
curl http://localhost:3939/api/items
```

## Architecture

```
src/
  cli.ts          CLI entry point -- start/stop/status/log commands
  index.ts        Server entry point -- starts server, prints URLs
  server.ts       HTTP server with REST API + static frontend
  storage.ts      Filesystem-backed store (save, list, delete, auto-cleanup)
  frontend.html   Single-file mobile web UI (no build step)
  __tests__/
    cli.test.ts
    server.test.ts
    storage.test.ts
```

Key design decisions:

- **No database** -- files go straight to disk, metadata is derived from filenames and `stat()`
- **No build step** -- the frontend is a single HTML file with inline CSS and JS
- **Filename-based typing** -- item type (file/text/clipboard) is inferred from filename patterns like `-snippet.txt` and `-clipboard`
- **Path traversal protection** -- filenames are sanitized, and `basename()` is applied before deletion

## Tests

```bash
bun test
```

## Requirements

- [Bun](https://bun.sh/) runtime
