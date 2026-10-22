import net from "node:net";

/** Literal loopback addresses only: DNS names are not a transport trust boundary. */
export function isLoopbackAddress(address: string | undefined): boolean {
  const ip = address?.toLowerCase().replace(/^::ffff:/, "");
  return ip === "::1" || (ip !== undefined && net.isIPv4(ip) && ip.startsWith("127."));
}

/** Apply this before storing or using credentials, including legacy peer.json files. */
export function requireSecureControlRoot(root: string): void {
  const url = new URL(root);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "root must be an origin without credentials, path, query or fragment",
    );
  }
  const ip = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackAddress(ip))) {
    return;
  }
  throw new Error(
    "remote peer control requires HTTPS; HTTP is only allowed on loopback IP addresses",
  );
}
