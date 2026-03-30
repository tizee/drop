import { join, basename } from "path";
import { mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "fs";

function getHome(): string {
  const home = process.env.HOME ?? Bun.env.HOME;
  if (!home) {
    throw new Error("HOME environment variable is not set. Cannot determine inbox directory. Set DROP_DIR explicitly.");
  }
  return home;
}

const DEFAULT_INBOX_DIR = process.env.DROP_DIR ?? join(getHome(), ".drop", "inbox");

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface DropItem {
  id: string;
  filename: string;
  path: string;
  type: "file" | "text" | "clipboard";
  size: number;
  createdAt: number;
}

export function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
}

let counter = 0;
function makeFilename(originalName: string): string {
  return `${Date.now()}-${counter++}-${sanitize(originalName)}`;
}

export class Store {
  readonly inboxDir: string;

  constructor(inboxDir?: string) {
    this.inboxDir = inboxDir ?? DEFAULT_INBOX_DIR;
  }

  ensureInbox(): void {
    if (!existsSync(this.inboxDir)) {
      mkdirSync(this.inboxDir, { recursive: true });
    }
  }

  async saveFile(
    file: File,
    type: "file" | "clipboard" = "file"
  ): Promise<DropItem> {
    const filename = makeFilename(file.name);
    const path = join(this.inboxDir, filename);
    await Bun.write(path, file);
    const stat = statSync(path);
    return {
      id: filename,
      filename,
      path,
      type,
      size: stat.size,
      createdAt: stat.mtimeMs,
    };
  }

  async saveText(
    text: string,
    type: "text" | "clipboard" = "text"
  ): Promise<DropItem> {
    const label = type === "clipboard" ? "clipboard" : "snippet";
    const filename = makeFilename(`${label}.txt`);
    const path = join(this.inboxDir, filename);
    await Bun.write(path, text);
    return {
      id: filename,
      filename,
      path,
      type,
      size: Buffer.byteLength(text),
      createdAt: Date.now(),
    };
  }

  listItems(): DropItem[] {
    if (!existsSync(this.inboxDir)) return [];
    const entries = readdirSync(this.inboxDir);
    const items: DropItem[] = [];

    for (const name of entries) {
      const path = join(this.inboxDir, name);
      try {
        const stat = statSync(path);
        if (!stat.isFile()) continue;

        let type: DropItem["type"] = "file";
        if (name.includes("-snippet.txt")) type = "text";
        else if (name.includes("-clipboard")) type = "clipboard";

        items.push({
          id: name,
          filename: name,
          path,
          type,
          size: stat.size,
          createdAt: stat.mtimeMs,
        });
      } catch {
        // skip unreadable entries
      }
    }

    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  deleteItem(id: string): boolean {
    const path = join(this.inboxDir, basename(id)); // prevent path traversal
    if (existsSync(path)) {
      unlinkSync(path);
      return true;
    }
    return false;
  }

  clearAll(): number {
    const items = this.listItems();
    let count = 0;
    for (const item of items) {
      try {
        unlinkSync(item.path);
        count++;
      } catch {
        // ignore
      }
    }
    return count;
  }

  autoCleanup(): number {
    const now = Date.now();
    const items = this.listItems();
    let count = 0;
    for (const item of items) {
      if (now - item.createdAt > MAX_AGE_MS) {
        try {
          unlinkSync(item.path);
          count++;
        } catch {
          // ignore
        }
      }
    }
    return count;
  }
}
