// Whether a Postgres connection must use TLS. Self-hosters on a NAS or in a compose stack must not need certificates,
// so only a host the internet could reach has it forced on.

/**
 * Domain suffixes reserved for, or conventionally used on, private networks. `.local` is mDNS, `.home.arpa` is the
 * RFC 8375 name for a home network, and the rest are what routers and Docker hosts are actually called.
 */
const PRIVATE_SUFFIXES: readonly string[] = [
  '.lan',
  '.local',
  '.localdomain',
  '.home',
  '.home.arpa',
  '.internal',
  '.intranet',
  '.private',
];

/**
 * IPv4 blocks that never route off a private network, by first octet and the span of second octets: loopback, the
 * three RFC 1918 ranges, then link-local.
 */
const PRIVATE_IPV4: readonly { first: number; low: number; high: number }[] = [
  { first: 127, low: 0, high: 255 },
  { first: 10, low: 0, high: 255 },
  { first: 172, low: 16, high: 31 },
  { first: 192, low: 168, high: 168 },
  { first: 169, low: 254, high: 254 },
];

/**
 * Whether a host is this machine or on a private network. Wider than loopback, because self-hosting is: a compose
 * service and a box on the LAN are both names nothing outside can reach.
 *
 * @param hostname - The host from a URL, lowercased and without IPv6 brackets.
 * @returns True for localhost, a dotless name, a private-use suffix or a private address.
 */
export function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return true;
  }
  // A name with no dots is a container or LAN hostname, not a public address.
  if (hostname.includes('.') === false && hostname.includes(':') === false) {
    return true;
  }
  if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const firstOctet = Number(ipv4[1]);
    const secondOctet = Number(ipv4[2]);
    return PRIVATE_IPV4.some(
      (range) => range.first === firstOctet && secondOctet >= range.low && secondOctet <= range.high,
    );
  }
  // Loopback, unique-local fc00::/7, then link-local fe80::/10.
  return hostname === '::1' || /^f[cd]/.test(hostname) || /^fe[89ab]/.test(hostname);
}

/**
 * Whether to insist on TLS for a connection string. Read from the parsed hostname, never the raw string: a URL with
 * credentials puts the userinfo where a prefix match looks for the host.
 *
 * @param url - The `DATABASE_URL`.
 * @returns False when the URL sets its own `sslmode` (the operator's decision, which node-postgres reads itself), for
 * a private or local host, and for a URL that does not parse.
 */
export function requiresSsl(url: string): boolean {
  if (/[?&]sslmode=/i.test(url)) {
    return false;
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    // Not a URL: env.ts has already refused it at boot, so there is no host to judge.
    return false;
  }
  return isPrivateHost(hostname) === false;
}
