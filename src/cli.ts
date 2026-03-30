#!/usr/bin/env bun

import { spawn } from "child_process";
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const DROP_DIR = process.env.DROP_DIR ?? join(process.env.HOME!, ".drop");
const PID_FILE = join(DROP_DIR, "drop.pid");
const LOG_FILE = join(DROP_DIR, "drop.log");
const SERVER_ENTRY = join(import.meta.dir, "index.ts");

function ensureDropDir(): void {
  if (!existsSync(DROP_DIR)) {
    mkdirSync(DROP_DIR, { recursive: true });
  }
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, "utf-8").trim();
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

function cleanStalePid(): void {
  const pid = readPid();
  if (pid !== null && !isProcessAlive(pid)) {
    unlinkSync(PID_FILE);
  }
}

function start(port?: number, dir?: string): void {
  ensureDropDir();
  cleanStalePid();

  const existingPid = readPid();
  if (existingPid !== null) {
    console.log(`drop is already running (pid ${existingPid})`);
    process.exit(1);
  }

  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (port !== undefined) env.DROP_PORT = String(port);
  if (dir !== undefined) env.DROP_DIR = dir;

  const logFd = openSync(LOG_FILE, "w");

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
  writeFileSync(PID_FILE, String(child.pid));

  console.log(`drop started (pid ${child.pid})`);
  console.log(`  Port: ${port ?? process.env.DROP_PORT ?? 3939}`);
  console.log(`  Dir:  ${dir ?? process.env.DROP_DIR ?? join(process.env.HOME!, ".drop", "inbox")}`);
  console.log(`  Log:  ${LOG_FILE}`);
}

function stop(): void {
  cleanStalePid();

  const pid = readPid();
  if (pid === null) {
    console.log("drop is not running");
    process.exit(1);
  }

  try {
    process.kill(pid, "SIGTERM");
    unlinkSync(PID_FILE);
    console.log(`drop stopped (pid ${pid})`);
  } catch (e: any) {
    if (e.code === "ESRCH") {
      unlinkSync(PID_FILE);
      console.log("drop was not running (stale pid file removed)");
    } else {
      throw e;
    }
  }
}

function status(): void {
  cleanStalePid();

  const pid = readPid();
  if (pid === null) {
    console.log("drop is not running");
    process.exit(1);
  }

  console.log(`drop is running (pid ${pid})`);
}

function printLog(lines: number): void {
  if (!existsSync(LOG_FILE)) {
    console.log("No log file found");
    process.exit(1);
  }
  const content = readFileSync(LOG_FILE, "utf-8");
  const allLines = content.split("\n");
  const tail = allLines.slice(-lines).join("\n");
  console.log(tail);
}

function usage(): void {
  console.log(`usage: drop <command> [options]

commands:
  start   Start the drop server in the background
  stop    Stop the running drop server
  status  Check if the drop server is running
  log     Show recent server log output

options:
  --port <port>    Set server port (default: 3939, env: DROP_PORT)
  --dir <path>     Set inbox directory (default: ~/.drop/inbox, env: DROP_DIR)
  --lines <n>      Number of log lines to show (default: 20, for 'log' command)
  --help           Show this help message`);
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
    start(port, dir);
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
  default:
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
}
