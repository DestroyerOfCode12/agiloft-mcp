import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { AgiloftError } from './errors.ts';

/**
 * Outbound destination policy for Agiloft connections (SSRF protection).
 *
 * - HTTPS only (plain HTTP only for loopback in explicit, non-production test mode)
 * - No credentials, query string or fragment in the base URL
 * - Hostname must match an allowed suffix (cloud) or an explicit on-premises host
 * - Cloud hosts must resolve to public addresses only
 * - On-premises hosts may resolve to private ranges, never to loopback,
 *   link-local or cloud metadata addresses
 * - DNS is re-checked at connection time (see http.ts) to resist rebinding
 */
export interface DestinationPolicy {
  allowedHostSuffixes: string[];
  onPremHosts: string[];
  allowInsecureLoopback: boolean;
}

const ALWAYS_BLOCKED = new BlockList();
ALWAYS_BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4');
ALWAYS_BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4');
ALWAYS_BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4');
ALWAYS_BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4');
ALWAYS_BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4');
ALWAYS_BLOCKED.addAddress('::', 'ipv6');
ALWAYS_BLOCKED.addAddress('::1', 'ipv6');
ALWAYS_BLOCKED.addSubnet('fe80::', 10, 'ipv6');
ALWAYS_BLOCKED.addSubnet('ff00::', 8, 'ipv6');

const PRIVATE = new BlockList();
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE.addSubnet('198.18.0.0', 15, 'ipv4');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');

function family(ip: string): 'ipv4' | 'ipv6' {
  return isIP(ip) === 6 ? 'ipv6' : 'ipv4';
}

function unmapV4(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m?.[1] ?? ip;
}

export type AddressClass = 'blocked' | 'private' | 'public';

export function classifyAddress(rawIp: string): AddressClass {
  const ip = unmapV4(rawIp);
  const fam = family(ip);
  if (ALWAYS_BLOCKED.check(ip, fam)) return 'blocked';
  if (PRIVATE.check(ip, fam)) return 'private';
  return 'public';
}

export interface ValidatedDestination {
  url: URL;
  hostname: string;
  onPrem: boolean;
}

function hostMatches(hostname: string, entry: string): boolean {
  const e = entry.trim().toLowerCase();
  if (!e) return false;
  return (
    hostname === e || (e.startsWith('.') && hostname.endsWith(e)) || hostname.endsWith(`.${e}`)
  );
}

export function validateBaseUrl(raw: string, policy: DestinationPolicy): ValidatedDestination {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AgiloftError('unsafe_url', 'The Agiloft URL is not a valid absolute URL.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (url.username || url.password) {
    throw new AgiloftError('unsafe_url', 'Credentials must not be included in the Agiloft URL.');
  }
  if (url.search || url.hash) {
    throw new AgiloftError(
      'unsafe_url',
      'The Agiloft URL must not contain a query string or fragment.',
    );
  }
  const loopback = hostname === 'localhost' || /^127\./.test(hostname) || hostname === '::1';
  if (url.protocol !== 'https:') {
    if (!(url.protocol === 'http:' && loopback && policy.allowInsecureLoopback)) {
      throw new AgiloftError('unsafe_url', 'Agiloft connections must use HTTPS.');
    }
  }
  if (loopback) {
    if (!policy.allowInsecureLoopback) {
      throw new AgiloftError('unsafe_url', 'Loopback destinations are not permitted.');
    }
    return { url, hostname, onPrem: true };
  }
  if (isIP(hostname) !== 0) {
    if (!policy.onPremHosts.some((h) => h.trim().toLowerCase() === hostname)) {
      throw new AgiloftError(
        'unsafe_url',
        'IP-address destinations must be listed explicitly as approved on-premises hosts.',
      );
    }
  }
  const onPrem = policy.onPremHosts.some((h) => h.trim().toLowerCase() === hostname);
  const cloud = policy.allowedHostSuffixes.some((s) => hostMatches(hostname, s));
  if (!onPrem && !cloud) {
    throw new AgiloftError(
      'unsafe_url',
      `Host "${hostname}" is not an approved Agiloft destination. An administrator must add it to AGILOFT_ALLOWED_HOST_SUFFIXES or AGILOFT_ONPREM_HOSTS.`,
    );
  }
  if (url.port && !onPrem && url.port !== '443') {
    throw new AgiloftError(
      'unsafe_url',
      'Non-standard ports are only permitted for approved on-premises hosts.',
    );
  }
  return { url, hostname, onPrem };
}

export function assertAddressAllowed(
  address: string,
  dest: { onPrem: boolean },
  policy: DestinationPolicy,
): void {
  const cls = classifyAddress(address);
  if (cls === 'blocked') {
    const loop = /^(127\.|::1$|::ffff:127\.)/.test(address);
    if (loop && policy.allowInsecureLoopback) return;
    throw new AgiloftError('unsafe_url', 'The Agiloft host resolves to a blocked address range.');
  }
  if (cls === 'private' && !dest.onPrem) {
    throw new AgiloftError(
      'unsafe_url',
      'The Agiloft host resolves to a private address but is not an approved on-premises host.',
    );
  }
}

/** Resolves and checks all addresses up front (used when saving a connection). */
export async function checkResolvedAddresses(
  dest: ValidatedDestination,
  policy: DestinationPolicy,
): Promise<string[]> {
  if (isIP(dest.hostname)) {
    assertAddressAllowed(dest.hostname, dest, policy);
    return [dest.hostname];
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(dest.hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw new AgiloftError('network', `Could not resolve host "${dest.hostname}".`, {
      cause,
      writeOutcome: 'not_sent',
    });
  }
  for (const a of addresses) assertAddressAllowed(a.address, dest, policy);
  return addresses.map((a) => a.address);
}
