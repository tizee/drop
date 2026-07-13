#!/usr/bin/env bun

import { spawn } from "child_process";
import { basename, join } from "path";
import { existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { expandUserPath, resolveControlDir, resolveInboxDir } from "./paths";
import { detectAddresses, formatEndpoints } from "./network";

const SERVER_ENTRY = join(import.meta.dir, "index.ts");

interface CliPaths {
  controlDir: string;
  pidFile: string;
  logFile: string;
}

function getCliPaths(env: NodeJS.ProcessEnv = process.env): CliPaths {
  const controlDir = resolveControlDir(env);
  return {
    controlDir,
    pidFile: join(controlDir, "drop.pid"),
    logFile: join(controlDir, "drop.log"),
  };
}

function ensureDropDir(controlDir: string): void {
  if (!existsSync(controlDir)) {
    mkdirSync(controlDir, { recursive: true });
  }
}

function readPid(paths: CliPaths): number | null {
  if (!existsSync(paths.pidFile)) return null;
  const raw = readFileSync(paths.pidFile, "utf-8").trim();
  const pid = parseInt(raw, 10);
  return Number.isNaN(pid) ? null : pid;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}

function cleanStalePid(paths: CliPaths): void {
  const pid = readPid(paths);
  if (pid !== null && !isProcessAlive(pid)) {
    unlinkSync(paths.pidFile);
  }
}

async function start(port?: number, dir?: string): Promise<void> {
  const paths = getCliPaths();
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  const inboxDir = resolveInboxDir(dir, env, dir !== undefined ? "--dir" : "DROP_DIR");

  ensureDropDir(paths.controlDir);
  cleanStalePid(paths);

  const existingPid = readPid(paths);
  if (existingPid !== null) {
    console.log(`drop is already running (pid ${existingPid})`);
    process.exit(1);
  }

  if (port !== undefined) env.DROP_PORT = String(port);
  env.DROP_DIR = inboxDir;

  const logFd = openSync(paths.logFile, "w");

  const child = spawn("bun", ["run", SERVER_ENTRY], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env,
  });

  if (!child.pid) {
    console.error("Failed to start drop server");
    process.exit(1);
  }

  child.unref();
  writeFileSync(paths.pidFile, String(child.pid));

  // Wait for server to write actual port to log, then display it
  const actualPort = await waitForActualPort(paths.logFile, 3000);

  console.log(`drop started (pid ${child.pid})`);
  console.log(`  Port: ${actualPort ?? port ?? process.env.DROP_PORT ?? 3939}`);
  console.log(`  Dir:  ${inboxDir}`);
  console.log(`  Log:  ${paths.logFile}`);
}

async function waitForActualPort(logFile: string, timeoutMs: number): Promise<number | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const content = readFileSync(logFile, "utf-8");
      const match = content.match(/Local:\s+http:\/\/localhost:(\d+)/);
      if (match) return parseInt(match[1], 10);
    } catch {
      // log file not ready yet
    }
    await Bun.sleep(100);
  }
  return null;
}

function stop(): void {
  const paths = getCliPaths();
  cleanStalePid(paths);

  const pid = readPid(paths);
  if (pid === null) {
    console.log("drop is not running");
    process.exit(1);
  }

  try {
    process.kill(pid, "SIGTERM");
    unlinkSync(paths.pidFile);
    console.log(`drop stopped (pid ${pid})`);
  } catch (e: any) {
    if (e.code === "ESRCH") {
      unlinkSync(paths.pidFile);
      console.log("drop was not running (stale pid file removed)");
    } else {
      throw e;
    }
  }
}

function readServerInfoFromLog(logFile: string): { port: number | null; inboxDir: string | null } {
  if (!existsSync(logFile)) return { port: null, inboxDir: null };
  try {
    const content = readFileSync(logFile, "utf-8");
    const portMatch = content.match(/Local:\s+http:\/\/localhost:(\d+)/);
    const inboxMatch = content.match(/Inbox:\s+(.+)/);
    return {
      port: portMatch ? parseInt(portMatch[1], 10) : null,
      inboxDir: inboxMatch ? inboxMatch[1].trim() : null,
    };
  } catch {
    return { port: null, inboxDir: null };
  }
}

function status(): void {
  const paths = getCliPaths();
  cleanStalePid(paths);

  const pid = readPid(paths);
  if (pid === null) {
    console.log("drop is not running");
    process.exit(1);
  }

  console.log(`drop is running (pid ${pid})`);

  const { port, inboxDir } = readServerInfoFromLog(paths.logFile);
  if (port !== null) {
    for (const line of formatEndpoints(port, detectAddresses())) {
      console.log(`  ${line}`);
    }
  }
  if (inboxDir) console.log(`  Inbox:     ${inboxDir}`);
  console.log(`  Log:       ${paths.logFile}`);
}

function printLog(lines: number): void {
  const paths = getCliPaths();
  if (!existsSync(paths.logFile)) {
    console.log("No log file found");
    process.exit(1);
  }
  const content = readFileSync(paths.logFile, "utf-8");
  const allLines = content.split("\n");
  const tail = allLines.slice(-lines).join("\n");
  console.log(tail);
}

function getServerUrl(): string {
  const paths = getCliPaths();
  // Try to detect port from server log first
  if (existsSync(paths.logFile)) {
    try {
      const content = readFileSync(paths.logFile, "utf-8");
      const match = content.match(/Local:\s+http:\/\/localhost:(\d+)/);
      if (match) return `http://127.0.0.1:${match[1]}`;
    } catch {}
  }
  const port = process.env.DROP_PORT ?? "3939";
  return `http://127.0.0.1:${port}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadFiles(files: string[]): Promise<void> {
  const baseUrl = getServerUrl();

  // Verify server is reachable
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    if (!res.ok) throw new Error();
  } catch {
    console.error("drop server is not running. Start it with: drop start");
    process.exit(1);
  }

  for (const filePath of files) {
    let resolved: string;
    try {
      resolved = expandUserPath(filePath, process.env, "File path");
    } catch (e: any) {
      console.error(e.message);
      continue;
    }

    if (!existsSync(resolved)) {
      console.error(`File not found: ${filePath}`);
      continue;
    }

    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      console.error(`Skipping directory: ${filePath} (directories not supported)`);
      continue;
    }

    const file = Bun.file(resolved);
    const fd = new FormData();
    fd.append("file", new Blob([await file.arrayBuffer()]), basename(resolved));

    try {
      const res = await fetch(`${baseUrl}/api/upload`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const item = await res.json();
      console.log(`Uploaded: ${basename(resolved)} (${formatSize(stat.size)}) -> ${item.id}`);
    } catch (e: any) {
      console.error(`Failed to upload ${filePath}: ${e.message}`);
    }
  }
}

async function sendText(text: string): Promise<void> {
  if (!text.trim()) {
    console.error("No text provided");
    process.exit(1);
  }

  const baseUrl = getServerUrl();

  try {
    const res = await fetch(`${baseUrl}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });
    if (!res.ok) throw new Error(await res.text());
    const item = await res.json();
    console.log(`Sent: ${formatSize(item.size)} -> ${item.id}`);
  } catch (e: any) {
    if (e.message?.includes("fetch")) {
      console.error("drop server is not running. Start it with: drop start");
    } else {
      console.error(`Failed to send text: ${e.message}`);
    }
    process.exit(1);
  }
}

function usage(): void {
  console.log(`usage: drop <command> [options]

commands:
  start          Start the drop server in the background
  stop           Stop the running drop server
  status         Check if the drop server is running
  log            Show recent server log output
  cp <files...>  Upload files to inbox (downloadable from phone)
  send [text]    Send text to inbox (reads stdin if no text argument)

options:
  --port <port>    Set server port (default: 3939, env: DROP_PORT)
  --dir <path>     Set inbox directory (default: ~/.drop/inbox, env: DROP_DIR)
  --lines <n>      Number of log lines to show (default: 20, for 'log' command)
  --help           Show this help message

examples:
  drop cp photo.jpg notes.pdf         Upload files from computer
  drop send "Hello from CLI"          Send text from computer
  echo "config contents" | drop send  Pipe text via stdin
  pbpaste | drop send                 Send clipboard contents`);
}

// --- Argument parsing ---

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const hasHelp = args.includes("--help") || args.includes("-h");

if (!command || hasHelp) {
  usage();
  process.exit(hasHelp ? 0 : 1);
}

switch (command) {
  case "start": {
    const portStr = getFlag("--port");
    const port = portStr ? parseInt(portStr, 10) : undefined;
    if (portStr && (Number.isNaN(port) || port! < 0 || port! > 65535)) {
      console.error(`Invalid port: ${portStr}`);
      process.exit(1);
    }
    const dir = getFlag("--dir");
    await start(port, dir);
    break;
  }
  case "stop":
    stop();
    break;
  case "status":
    status();
    break;
  case "log": {
    const linesStr = getFlag("--lines");
    const lines = linesStr ? parseInt(linesStr, 10) : 20;
    printLog(lines);
    break;
  }
  case "cp": {
    const files = args.slice(1).filter(a => !a.startsWith("--"));
    if (!files.length) {
      console.error("No files specified");
      console.error("Usage: drop cp <file1> [file2] ...");
      process.exit(1);
    }
    await uploadFiles(files);
    break;
  }
  case "send": {
    // Collect non-flag args after "send"
    const textArgs = args.slice(1).filter(a => !a.startsWith("--"));
    if (textArgs.length > 0) {
      await sendText(textArgs.join(" "));
    } else if (!process.stdin.isTTY) {
      // Read from pipe/redirect
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString("utf-8");
      await sendText(text);
    } else {
      console.error("No text provided. Usage: drop send <text> (or pipe stdin)");
      process.exit(1);
    }
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
}
