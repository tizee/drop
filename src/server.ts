import { join } from "path";
import { Store } from "./storage";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export interface ServerOptions {
  port: number;
  store?: Store;
}

export function createServer({ port, store }: ServerOptions) {
  const s = store ?? new Store();
  s.ensureInbox();

  return Bun.serve({
    port,
    hostname: "0.0.0.0",

    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // Lazy auto-cleanup on every request
      s.autoCleanup();

      // --- API routes ---

      // Upload file
      if (method === "POST" && path === "/api/upload") {
        const formData = await req.formData();
        const file = formData.get("file");
        if (!file || !(file instanceof File)) {
          return err("No file provided");
        }
        const item = await s.saveFile(file, "file");
        return json(item, 201);
      }

      // Save text snippet
      if (method === "POST" && path === "/api/text") {
        const body = await req.json();
        const text = body?.text;
        if (!text || typeof text !== "string" || text.trim().length === 0) {
          return err("No text provided");
        }
        const item = await s.saveText(text.trim(), "text");
        return json(item, 201);
      }

      // Save clipboard content (text or image)
      if (method === "POST" && path === "/api/clipboard") {
        const contentType = req.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
          const body = await req.json();
          if (body?.text && typeof body.text === "string") {
            const item = await s.saveText(body.text, "clipboard");
            return json(item, 201);
          }
          return err("No clipboard text provided");
        }

        if (contentType.includes("multipart/form-data")) {
          const formData = await req.formData();
          const file = formData.get("file");
          if (file && file instanceof File) {
            const item = await s.saveFile(file, "clipboard");
            return json(item, 201);
          }
          return err("No clipboard file provided");
        }

        return err("Unsupported content type");
      }

      // List items
      if (method === "GET" && path === "/api/items") {
        return json(s.listItems());
      }

      // Delete single item
      if (method === "DELETE" && path.startsWith("/api/items/")) {
        const id = decodeURIComponent(path.slice("/api/items/".length));
        if (!id) return err("No id provided");
        const ok = s.deleteItem(id);
        return ok ? json({ ok: true }) : err("Not found", 404);
      }

      // Clear all
      if (method === "DELETE" && path === "/api/items") {
        const count = s.clearAll();
        return json({ ok: true, deleted: count });
      }

      // Serve raw file
      if (method === "GET" && path.startsWith("/raw/")) {
        const id = decodeURIComponent(path.slice("/raw/".length));
        const filePath = join(s.inboxDir, id.replace(/\.\./g, ""));
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }
        return err("Not found", 404);
      }

      // --- Frontend ---
      if (method === "GET" && (path === "/" || path === "/index.html")) {
        const html = Bun.file(join(import.meta.dir, "frontend.html"));
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return err("Not found", 404);
    },
  });
}
