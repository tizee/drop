import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Store } from "../storage";
import { createServer } from "../server";

let tempDir: string;
let store: Store;
let server: ReturnType<typeof createServer>;
let base: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "drop-server-test-"));
  store = new Store(tempDir);
  server = createServer({ port: 0, store }); // port 0 = random available port, no TLS for tests
  base = `http://localhost:${server.port}`;
});

afterEach(() => {
  server.stop(true);
  rmSync(tempDir, { recursive: true, force: true });
});

// --- POST /api/upload ---

describe("POST /api/upload", () => {
  it("uploads a file and returns 201", async () => {
    const fd = new FormData();
    fd.append("file", new File(["hello"], "test.txt", { type: "text/plain" }));

    const res = await fetch(`${base}/api/upload`, { method: "POST", body: fd });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.type).toBe("file");
    expect(body.filename).toContain("test.txt");
    expect(body.path).toStartWith(tempDir);
    expect(body.size).toBe(5);
  });

  it("returns 400 when no file provided", async () => {
    const fd = new FormData();
    fd.append("other", "value");

    const res = await fetch(`${base}/api/upload`, { method: "POST", body: fd });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("No file provided");
  });
});

// --- POST /api/text ---

describe("POST /api/text", () => {
  it("saves text and returns 201", async () => {
    const res = await fetch(`${base}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello world" }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.type).toBe("text");
    expect(body.filename).toContain("snippet.txt");
    expect(readFileSync(body.path, "utf-8")).toBe("hello world");
  });

  it("trims whitespace from text", async () => {
    const res = await fetch(`${base}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "  hello  " }),
    });
    const body = await res.json();
    expect(readFileSync(body.path, "utf-8")).toBe("hello");
  });

  it("returns 400 for empty text", async () => {
    const res = await fetch(`${base}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing text field", async () => {
    const res = await fetch(`${base}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "wrong field" }),
    });
    expect(res.status).toBe(400);
  });
});

// --- POST /api/clipboard ---

describe("POST /api/clipboard", () => {
  it("saves clipboard text (JSON)", async () => {
    const res = await fetch(`${base}/api/clipboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "pasted text" }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.type).toBe("clipboard");
    expect(body.filename).toContain("clipboard.txt");
  });

  it("saves clipboard file (multipart)", async () => {
    const fd = new FormData();
    fd.append(
      "file",
      new File(["image data"], "clipboard.png", { type: "image/png" })
    );

    const res = await fetch(`${base}/api/clipboard`, {
      method: "POST",
      body: fd,
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.type).toBe("clipboard");
    expect(body.filename).toContain("clipboard.png");
  });

  it("returns 400 for empty clipboard JSON", async () => {
    const res = await fetch(`${base}/api/clipboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for unsupported content type", async () => {
    const res = await fetch(`${base}/api/clipboard`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "just text",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Unsupported content type");
  });
});

// --- GET /api/items ---

describe("GET /api/items", () => {
  it("returns empty array initially", async () => {
    const res = await fetch(`${base}/api/items`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns uploaded items", async () => {
    // Upload 2 items
    await fetch(`${base}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "one" }),
    });
    await fetch(`${base}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "two" }),
    });

    const res = await fetch(`${base}/api/items`);
    const items = await res.json();
    expect(items.length).toBe(2);
    expect(items[0]).toHaveProperty("id");
    expect(items[0]).toHaveProperty("path");
    expect(items[0]).toHaveProperty("type");
  });
});

// --- DELETE /api/items/:id ---

describe("DELETE /api/items/:id", () => {
  it("deletes an item by id", async () => {
    const upload = await fetch(`${base}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "to delete" }),
    });
    const item = await upload.json();

    const res = await fetch(
      `${base}/api/items/${encodeURIComponent(item.id)}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Verify gone
    const list = await fetch(`${base}/api/items`);
    expect(await list.json()).toEqual([]);
  });

  it("returns 404 for non-existent id", async () => {
    const res = await fetch(`${base}/api/items/nonexistent.txt`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

// --- DELETE /api/items ---

describe("DELETE /api/items (clear all)", () => {
  it("clears all items", async () => {
    await fetch(`${base}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "one" }),
    });
    await fetch(`${base}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "two" }),
    });

    const res = await fetch(`${base}/api/items`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(2);

    const list = await fetch(`${base}/api/items`);
    expect(await list.json()).toEqual([]);
  });
});

// --- GET /raw/:id ---

describe("GET /raw/:id", () => {
  it("serves raw file content", async () => {
    const upload = await fetch(`${base}/api/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "raw content" }),
    });
    const item = await upload.json();

    const res = await fetch(`${base}/raw/${encodeURIComponent(item.id)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("raw content");
  });

  it("returns 404 for missing file", async () => {
    const res = await fetch(`${base}/raw/nonexistent.txt`);
    expect(res.status).toBe(404);
  });
});

// --- GET / ---

describe("GET /", () => {
  it("serves frontend HTML", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("drop");
  });
});

// --- 404 ---

describe("unknown routes", () => {
  it("returns 404 for unknown path", async () => {
    const res = await fetch(`${base}/unknown`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for wrong method", async () => {
    const res = await fetch(`${base}/api/items`, { method: "PUT" });
    expect(res.status).toBe(404);
  });
});
