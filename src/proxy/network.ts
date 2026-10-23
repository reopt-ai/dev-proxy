import net from "node:net";

/** Drop the IPv4-mapped IPv6 prefix so addresses read and compare as IPv4. */
export function plainAddress(address: string): string {
  return address.replace(/^::ffff:/i, "");
}

/** URL hostnames wrap IPv6 literals in brackets; socket addresses do not. */
export function hostAddress(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

/** Literal loopback addresses only: DNS names are not a transport trust boundary. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  const ip = plainAddress(address.toLowerCase());
  return ip === "::1" || (net.isIPv4(ip) && ip.startsWith("127."));
}

/** Apply this before storing or using credentials, including legacy peer.json files. */
export function requireSecureControlRoot(root: string): void {
  const url = new URL(root);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "root must be an origin without credentials, path, query or fragment",
    );
  }
  if (
    url.protocol === "https:" ||
    (url.protocol === "http:" && isLoopbackAddress(hostAddress(url.hostname)))
  ) {
    return;
  }
  throw new Error(
    "remote peer control requires HTTPS; HTTP is only allowed on loopback IP addresses",
  );
}
