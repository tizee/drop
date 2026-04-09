# drop

Share text, images, and files between your devices and your dev machine. Built with [Bun](https://bun.sh/).

`drop` is a bidirectional content bridge for your dev machine. Run it on your workstation, open the URL on your phone, and share content in both directions:
- **Phone to computer**: drop files, text, and clipboard content into a filesystem inbox for agents and scripts.
- **Computer to phone**: upload files and text via CLI, then download or copy them on your phone.

**Tailscale gives you secure reachability to your dev machine. `drop` turns that reachability into a practical inbox for text, images, and files.**

Works on plain LAN out of the box. Pair it with [Tailscale](https://tailscale.com/) to reach your dev machine from anywhere on your tailnet -- no port forwarding, no certs, no auth layer to build.

## What it does

- Mobile-friendly web UI on `0.0.0.0:3939` (configurable)
- Accepts file uploads, text snippets, and clipboard content (text or images) via REST API
- CLI commands to upload files (`drop cp`) and send text (`drop send`) from your workstation
- Frontend supports downloading files and copying text content with one tap
- Saves everything to `~/.drop/inbox/` with timestamped filenames
- Auto-cleans items older than 24 hours
- Shows full filesystem paths so you can feed them to agents or scripts

## Why not Taildrop?

[Taildrop](https://tailscale.com/kb/1106/taildrop/) solves **file transfer between devices**. `drop` solves **content intake into a dev workflow**:

- Taildrop transfers files. `drop` also handles text snippets and clipboard content (paste an image, paste a code block).
- Taildrop delivers files to a download folder. `drop` delivers to a structured inbox with timestamped filenames, filesystem paths you can copy, and auto-cleanup.
- Taildrop requires the Tailscale client on both ends. `drop` only needs a browser on the sending device.

They're complementary: Tailscale handles secure connectivity, `drop` handles the last mile of getting arbitrary content into your working directory.

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

## CLI

The `drop` CLI manages the server as a background process (PID file at `~/.drop/drop.pid`) and provides commands to share content from your workstation.

### Service management

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

### Share content from your workstation

Upload files or send text to the inbox, then download or copy them on your phone via the web UI.

```bash
# Upload files (downloadable on phone)
drop cp photo.jpg notes.pdf
drop cp ~/Desktop/config.yaml

# Send text (copyable on phone)
drop send "The WiFi password is hunter2"
echo "export API_KEY=..." | drop send    # pipe from stdin
pbpaste | drop send                       # send clipboard contents
```

The `cp` and `send` commands require a running server (they act as HTTP clients). The server port is auto-detected from the server log.

| Command | Description |
|---------|-------------|
| `drop start` | Start server in background, write PID to `~/.drop/drop.pid` |
| `drop stop` | Stop the background server |
| `drop status` | Check if the server is running |
| `drop log` | Show recent server log output (`~/.drop/drop.log`) |
| `drop cp <files...>` | Upload files to inbox (downloadable from phone) |
| `drop send [text]` | Send text to inbox; reads stdin if no argument (copyable from phone) |

Path handling notes:

- `--dir` and `DROP_DIR` accept either an absolute path or `~/...`
- Literal `~` values are expanded by `drop` before use
- `HOME` must be set to an absolute path when `drop` needs it
- Invalid home-style paths such as `~otheruser/inbox` are rejected
- Broken path config fails fast instead of silently creating relative directories

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
| `DROP_DIR` | `~/.drop/inbox`    | Inbox directory on disk; accepts an absolute path or `~/...` |

Notes:

- If `DROP_DIR` is unset, `drop` uses `$HOME/.drop/inbox`
- `HOME` must be an absolute path; invalid values are rejected at startup

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
  cli.ts          CLI entry point -- start/stop/status/log/cp/send commands
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
