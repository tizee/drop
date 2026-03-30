import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Store, sanitize } from "../storage";

let tempDir: string;
let store: Store;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "drop-test-"));
  store = new Store(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// --- sanitize ---

describe("sanitize", () => {
  it("keeps alphanumeric, dots, hyphens, underscores", () => {
    expect(sanitize("hello-world_v2.txt")).toBe("hello-world_v2.txt");
  });

  it("replaces special characters with underscores", () => {
    expect(sanitize("my file (1).png")).toBe("my_file__1_.png");
  });

  it("replaces unicode characters", () => {
    // JS regex replaces per code point, so each CJK char -> one underscore
    expect(sanitize("photo.jpg")).toBe("photo.jpg");
  });

  it("truncates to 128 chars", () => {
    const long = "a".repeat(200) + ".txt";
    expect(sanitize(long).length).toBe(128);
  });

  it("handles empty string", () => {
    expect(sanitize("")).toBe("");
  });

  it("replaces path traversal characters", () => {
    // '/' replaced with '_', but '.' is kept (allowed by regex)
    const result = sanitize("../../etc/passwd");
    expect(result).not.toContain("/");
    expect(result).toBe(".._.._etc_passwd");
  });
});

// --- ensureInbox ---

describe("ensureInbox", () => {
  it("creates directory if not exists", () => {
    const nested = join(tempDir, "sub", "deep");
    const s = new Store(nested);
    expect(existsSync(nested)).toBe(false);
    s.ensureInbox();
    expect(existsSync(nested)).toBe(true);
  });

  it("is idempotent", () => {
    store.ensureInbox();
    store.ensureInbox();
    expect(existsSync(tempDir)).toBe(true);
  });
});

// --- saveFile ---

describe("saveFile", () => {
  it("saves a file and returns DropItem", async () => {
    const file = new File(["hello world"], "test.txt", { type: "text/plain" });
    const item = await store.saveFile(file);

    expect(item.type).toBe("file");
    expect(item.filename).toMatch(/^\d+-\d+-test\.txt$/);
    expect(item.path).toBe(join(tempDir, item.filename));
    expect(item.size).toBe(11);
    expect(existsSync(item.path)).toBe(true);
    expect(readFileSync(item.path, "utf-8")).toBe("hello world");
  });

  it("saves as clipboard type when specified", async () => {
    const file = new File(["img data"], "clipboard.png", { type: "image/png" });
    const item = await store.saveFile(file, "clipboard");
    expect(item.type).toBe("clipboard");
    expect(item.filename).toContain("clipboard.png");
  });

  it("sanitizes filenames with special chars", async () => {
    const file = new File(["data"], "my photo (1).jpg", { type: "image/jpeg" });
    const item = await store.saveFile(file);
    expect(item.filename).toMatch(/^\d+-\d+-my_photo__1_\.jpg$/);
  });
});

// --- saveText ---

describe("saveText", () => {
  it("saves text snippet", async () => {
    const item = await store.saveText("hello world");
    expect(item.type).toBe("text");
    expect(item.filename).toMatch(/^\d+-\d+-snippet\.txt$/);
    expect(readFileSync(item.path, "utf-8")).toBe("hello world");
  });

  it("saves clipboard text", async () => {
    const item = await store.saveText("clipboard content", "clipboard");
    expect(item.type).toBe("clipboard");
    expect(item.filename).toMatch(/^\d+-\d+-clipboard\.txt$/);
  });

  it("handles multibyte text correctly", async () => {
    const text = "hello world";
    const item = await store.saveText(text);
    expect(item.size).toBe(Buffer.byteLength(text));
    expect(readFileSync(item.path, "utf-8")).toBe(text);
  });
});

// --- listItems ---

describe("listItems", () => {
  it("returns empty array for empty inbox", () => {
    expect(store.listItems()).toEqual([]);
  });

  it("returns empty array for non-existent directory", () => {
    const s = new Store(join(tempDir, "nonexistent"));
    expect(s.listItems()).toEqual([]);
  });

  it("lists saved items sorted by creation time descending", async () => {
    await store.saveText("first");
    await Bun.sleep(10); // ensure different timestamps
    await store.saveText("second");

    const items = store.listItems();
    expect(items.length).toBe(2);
    expect(items[0].createdAt).toBeGreaterThanOrEqual(items[1].createdAt);
  });

  it("detects types from filenames", async () => {
    await store.saveText("text", "text");
    await store.saveText("clip", "clipboard");
    const file = new File(["data"], "photo.png", { type: "image/png" });
    await store.saveFile(file);

    const items = store.listItems();
    const types = items.map((i) => i.type).sort();
    expect(types).toEqual(["clipboard", "file", "text"]);
  });

  it("skips subdirectories", async () => {
    const { mkdirSync } = await import("fs");
    mkdirSync(join(tempDir, "subdir"));
    await store.saveText("hello");

    const items = store.listItems();
    expect(items.length).toBe(1);
  });
});

// --- deleteItem ---

describe("deleteItem", () => {
  it("deletes existing item", async () => {
    const item = await store.saveText("to delete");
    expect(store.deleteItem(item.id)).toBe(true);
    expect(existsSync(item.path)).toBe(false);
  });

  it("returns false for non-existent item", () => {
    expect(store.deleteItem("nonexistent.txt")).toBe(false);
  });

  it("prevents path traversal", async () => {
    // Write a file outside inbox
    const outsideFile = join(tmpdir(), "drop-test-outside.txt");
    writeFileSync(outsideFile, "secret");

    // Attempt traversal
    const result = store.deleteItem(`../../${outsideFile}`);
    // basename() strips the path, so it looks for the filename in inbox dir
    expect(existsSync(outsideFile)).toBe(true);

    // cleanup
    rmSync(outsideFile, { force: true });
  });
});

// --- clearAll ---

describe("clearAll", () => {
  it("removes all items and returns count", async () => {
    await store.saveText("one");
    await store.saveText("two");
    await store.saveText("three");

    expect(store.clearAll()).toBe(3);
    expect(store.listItems()).toEqual([]);
  });

  it("returns 0 for empty inbox", () => {
    expect(store.clearAll()).toBe(0);
  });
});

// --- autoCleanup ---

describe("autoCleanup", () => {
  it("removes items older than 24 hours", async () => {
    const item = await store.saveText("old item");

    // Backdate the file's mtime to 25 hours ago
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(item.path, oldTime, oldTime);

    const cleaned = store.autoCleanup();
    expect(cleaned).toBe(1);
    expect(existsSync(item.path)).toBe(false);
  });

  it("keeps items younger than 24 hours", async () => {
    const item = await store.saveText("recent item");
    const cleaned = store.autoCleanup();
    expect(cleaned).toBe(0);
    expect(existsSync(item.path)).toBe(true);
  });

  it("only removes expired items in mixed set", async () => {
    const old = await store.saveText("old");
    const recent = await store.saveText("recent");

    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(old.path, oldTime, oldTime);

    const cleaned = store.autoCleanup();
    expect(cleaned).toBe(1);
    expect(existsSync(old.path)).toBe(false);
    expect(existsSync(recent.path)).toBe(true);
  });
});
