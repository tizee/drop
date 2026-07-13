import { createServer } from "./server";
import { detectAddresses, formatEndpoints } from "./network";
import { Store } from "./storage";

const PREFERRED_PORT = parseInt(process.env.DROP_PORT ?? "3939", 10);
const store = new Store();

function startServer(port: number): ReturnType<typeof createServer> {
  try {
    return createServer({ port, store });
  } catch (e: any) {
    if (e?.code === "EADDRINUSE") {
      console.log(`  Port ${port} in use, trying next...`);
      return startServer(port + 1);
    }
    throw e;
  }
}

const server = startServer(PREFERRED_PORT);
const endpoints = formatEndpoints(server.port, detectAddresses())
  .map((line) => `  ${line}`)
  .join("\n");

console.log(`
  drop - LAN inbox for coding agents

${endpoints}
  Inbox:     ${store.inboxDir}

  Env:       DROP_PORT (default 3939), DROP_DIR (default ~/.drop/inbox)

  Open the LAN or Tailscale URL on your phone to start dropping files.
`);
