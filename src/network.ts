import { networkInterfaces } from "os";

export interface NetworkAddresses {
  /** First non-internal physical IPv4 address (e.g. Wi-Fi/Ethernet LAN). */
  lan: string | null;
  /** First Tailscale IPv4 address (CGNAT range 100.64.0.0/10), if any. */
  tailscale: string | null;
}

/**
 * Tailscale assigns each node an address from the CGNAT range 100.64.0.0/10,
 * i.e. 100.64.x.x through 100.127.x.x.
 */
function isTailscaleAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  return first === 100 && second >= 64 && second <= 127;
}

/**
 * Split network interfaces into the physical LAN address and the Tailscale
 * address so the startup banner can advertise both. Ignores internal
 * (loopback) and non-IPv4 addresses, and keeps the first match of each kind.
 */
export function classifyAddresses(nets: ReturnType<typeof networkInterfaces>): NetworkAddresses {
  const result: NetworkAddresses = { lan: null, tailscale: null };

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (isTailscaleAddress(net.address)) {
        result.tailscale ??= net.address;
      } else {
        result.lan ??= net.address;
      }
    }
  }

  return result;
}

/** Classify the live network interfaces of the current host. */
export function detectAddresses(): NetworkAddresses {
  return classifyAddresses(networkInterfaces());
}

/**
 * Build the human-facing endpoint URL lines (Local / LAN / Tailscale) for a
 * given port. The Tailscale line is omitted when no Tailscale address exists.
 * Returned unindented so callers can prefix their own padding.
 */
export function formatEndpoints(port: number, addr: NetworkAddresses): string[] {
  const lines = [
    `Local:     http://localhost:${port}`,
    `LAN:       http://${addr.lan ?? "<no-network>"}:${port}`,
  ];
  if (addr.tailscale) {
    lines.push(`Tailscale: http://${addr.tailscale}:${port}`);
  }
  return lines;
}
