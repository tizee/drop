import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI_PATH = join(import.meta.dir, "..", "cli.ts");

function run(args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bun", "run", CLI_PATH, ...args], {
    env: { ...process.env, ...env },
  });
  return {
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    exitCode: result.exitCode,
  };
}

describe("cli", () => {
  let tmpDir: string;
  let inboxDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "drop-cli-test-"));
    inboxDir = join(tmpDir, "inbox");
  });

  afterEach(() => {
    // stop any server we may have started
    const pidFile = join(tmpDir, "drop.pid");
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prints usage with no arguments", () => {
    const r = run([], { DROP_DIR: tmpDir });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("usage: drop");
  });

  it("prints usage with --help", () => {
    const r = run(["--help"], { DROP_DIR: tmpDir });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("usage: drop");
  });

  it("rejects unknown command", () => {
    const r = run(["bogus"], { DROP_DIR: tmpDir });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Unknown command: bogus");
  });

  it("rejects invalid port", () => {
    const r = run(["start", "--port", "abc"], { DROP_DIR: tmpDir });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Invalid port");
  });

  it("status reports not running when no pid file", () => {
    const r = run(["status"], { DROP_DIR: tmpDir });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("not running");
  });

  it("status cleans stale pid file", () => {
    writeFileSync(join(tmpDir, "drop.pid"), "999999");
    const r = run(["status"], { DROP_DIR: tmpDir });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("not running");
    expect(existsSync(join(tmpDir, "drop.pid"))).toBe(false);
  });

  it("stop reports not running when no pid file", () => {
    const r = run(["stop"], { DROP_DIR: tmpDir });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("not running");
  });

  it("start + status + stop lifecycle", () => {
    const startResult = run(["start", "--port", "0", "--dir", inboxDir], { DROP_DIR: tmpDir });
    expect(startResult.exitCode).toBe(0);
    expect(startResult.stdout).toContain("drop started");

    // pid file should exist
    const pidFile = join(tmpDir, "drop.pid");
    expect(existsSync(pidFile)).toBe(true);
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    expect(pid).toBeGreaterThan(0);

    // status should report running
    const statusResult = run(["status"], { DROP_DIR: tmpDir });
    expect(statusResult.exitCode).toBe(0);
    expect(statusResult.stdout).toContain("running");
    expect(statusResult.stdout).toContain(String(pid));

    // stop should succeed
    const stopResult = run(["stop"], { DROP_DIR: tmpDir });
    expect(stopResult.exitCode).toBe(0);
    expect(stopResult.stdout).toContain("stopped");
    expect(existsSync(pidFile)).toBe(false);
  });

  it("start rejects when already running", () => {
    const r1 = run(["start", "--port", "0", "--dir", inboxDir], { DROP_DIR: tmpDir });
    expect(r1.exitCode).toBe(0);

    const r2 = run(["start", "--port", "0", "--dir", inboxDir], { DROP_DIR: tmpDir });
    expect(r2.exitCode).toBe(1);
    expect(r2.stdout).toContain("already running");
  });

  it("log reports no log file when none exists", () => {
    const r = run(["log"], { DROP_DIR: tmpDir });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("No log file");
  });
});
