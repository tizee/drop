import { describe, it, expect } from "bun:test";
import type { networkInterfaces } from "os";
import { classifyAddresses, formatEndpoints } from "../network";

type Nets = ReturnType<typeof networkInterfaces>;

// Build a minimal interface map shaped like os.networkInterfaces() output.
function nets(entries: Record<string, Array<{ address: string; family: "IPv4" | "IPv6"; internal: boolean }>>): Nets {
  return entries as unknown as Nets;
}

describe("classifyAddresses", () => {
  it("separates a Tailscale CGNAT address from the physical LAN address", () => {
    const result = classifyAddresses(nets({
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      en0: [{ address: "192.168.71.24", family: "IPv4", internal: false }],
      utun4: [{ address: "100.95.81.6", family: "IPv4", internal: false }],
    }));
    expect(result.lan).toBe("192.168.71.24");
    expect(result.tailscale).toBe("100.95.81.6");
  });

  it("reports no Tailscale address when no CGNAT interface is present", () => {
    const result = classifyAddresses(nets({
      en0: [{ address: "10.0.0.5", family: "IPv4", internal: false }],
    }));
    expect(result.lan).toBe("10.0.0.5");
    expect(result.tailscale).toBeNull();
  });

  it("ignores internal and IPv6 addresses", () => {
    const result = classifyAddresses(nets({
      lo0: [
        { address: "127.0.0.1", family: "IPv4", internal: true },
        { address: "::1", family: "IPv6", internal: true },
      ],
      en0: [{ address: "fe80::1", family: "IPv6", internal: false }],
    }));
    expect(result.lan).toBeNull();
    expect(result.tailscale).toBeNull();
  });

  it("treats the CGNAT range boundaries (100.64 - 100.127) correctly", () => {
    expect(classifyAddresses(nets({ a: [{ address: "100.64.0.1", family: "IPv4", internal: false }] })).tailscale).toBe("100.64.0.1");
    expect(classifyAddresses(nets({ a: [{ address: "100.127.255.254", family: "IPv4", internal: false }] })).tailscale).toBe("100.127.255.254");
    // 100.128.x is outside CGNAT -> not Tailscale, falls through to LAN
    const outside = classifyAddresses(nets({ a: [{ address: "100.128.0.1", family: "IPv4", internal: false }] }));
    expect(outside.tailscale).toBeNull();
    expect(outside.lan).toBe("100.128.0.1");
  });

  it("keeps the first address of each kind when several exist", () => {
    const result = classifyAddresses(nets({
      en0: [{ address: "192.168.1.2", family: "IPv4", internal: false }],
      en1: [{ address: "192.168.1.3", family: "IPv4", internal: false }],
      utun4: [{ address: "100.100.100.100", family: "IPv4", internal: false }],
    }));
    expect(result.lan).toBe("192.168.1.2");
    expect(result.tailscale).toBe("100.100.100.100");
  });
});

describe("formatEndpoints", () => {
  it("lists Local, LAN and Tailscale URLs when a Tailscale address exists", () => {
    const lines = formatEndpoints(3939, { lan: "192.168.71.24", tailscale: "100.95.81.6" });
    expect(lines).toEqual([
      "Local:     http://localhost:3939",
      "LAN:       http://192.168.71.24:3939",
      "Tailscale: http://100.95.81.6:3939",
    ]);
  });

  it("omits the Tailscale line when there is no Tailscale address", () => {
    const lines = formatEndpoints(8080, { lan: "10.0.0.5", tailscale: null });
    expect(lines).toEqual([
      "Local:     http://localhost:8080",
      "LAN:       http://10.0.0.5:8080",
    ]);
    expect(lines.some((l) => l.includes("Tailscale"))).toBe(false);
  });

  it("shows a placeholder when no LAN address is available", () => {
    const lines = formatEndpoints(3939, { lan: null, tailscale: null });
    expect(lines[1]).toBe("LAN:       http://<no-network>:3939");
  });
});

