import { networkInterfaces } from "os";
import { createServer } from "./server";
import { Store } from "./storage";

const PREFERRED_PORT = parseInt(process.env.DROP_PORT ?? "3939", 10);
const store = new Store();

function getLanIP(): string | null {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

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
const lanIP = getLanIP();

console.log(`
  drop - LAN inbox for coding agents

  Local:   http://localhost:${server.port}
  LAN:     http://${lanIP ?? "<no-network>"}:${server.port}
  Inbox:   ${store.inboxDir}

  Env:     DROP_PORT (default 3939), DROP_DIR (default ~/.drop/inbox)

  Open the LAN URL on your phone to start dropping files.
`);
