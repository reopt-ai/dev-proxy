import * as os from "node:os";

/** IPv4 addresses other devices on the local network can reach this machine at. */
export function getLanAddresses(): string[] {
  const addrs: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addrs.push(entry.address);
    }
  }
  return addrs;
}
