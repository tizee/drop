import { isAbsolute, join } from "path";

function readHome(env: NodeJS.ProcessEnv): string | undefined {
  return env.HOME ?? Bun.env.HOME;
}

export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = readHome(env);
  if (!home) {
    throw new Error("HOME environment variable is not set. Cannot determine inbox directory. Set DROP_DIR explicitly.");
  }
  if (!isAbsolute(home)) {
    throw new Error(`HOME environment variable must be an absolute path. Received: ${home}`);
  }
  return home;
}

export function expandUserPath(path: string, env: NodeJS.ProcessEnv = process.env, label = "Path"): string {
  if (path === "~") {
    return getHomeDir(env);
  }
  if (path.startsWith("~/")) {
    return join(getHomeDir(env), path.slice(2));
  }
  if (path.startsWith("~")) {
    throw new Error(`${label} uses unsupported home syntax: ${path}. Use ~/... or an absolute path.`);
  }
  return path;
}

function requireAbsolutePath(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path or start with ~/. Received: ${path}`);
  }
  return path;
}

export function resolveInboxDir(
  inboxDir?: string,
  env: NodeJS.ProcessEnv = process.env,
  label = "DROP_DIR"
): string {
  const rawPath = inboxDir ?? env.DROP_DIR ?? join(getHomeDir(env), ".drop", "inbox");
  return requireAbsolutePath(expandUserPath(rawPath, env, label), label);
}

export function resolveControlDir(env: NodeJS.ProcessEnv = process.env): string {
  const rawPath = env.DROP_DIR ?? join(getHomeDir(env), ".drop");
  return requireAbsolutePath(expandUserPath(rawPath, env, "DROP_DIR"), "DROP_DIR");
}
