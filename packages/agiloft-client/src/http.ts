import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import dns from 'node:dns';
import { AgiloftError } from './errors.ts';
import {
  assertAddressAllowed,
  type DestinationPolicy,
  type ValidatedDestination,
} from './url-safety.ts';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: URLSearchParams;
  form?: URLSearchParams;
  headers?: Record<string, string>;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Minimal HTTPS client with:
 *  - DNS results checked against the destination policy at connect time
 *  - no redirect following (a redirect is returned as an error)
 *  - hard timeout and response-size limit
 *  - a record of whether the request body was fully sent, so callers can tell
 *    a definitely-not-applied failure from an ambiguous one
 */
export async function sendRequest(
  dest: ValidatedDestination,
  policy: DestinationPolicy,
  req: HttpRequest,
): Promise<HttpResponse> {
  const base = dest.url;
  const prefix = base.pathname.replace(/\/+$/, '');
  const target = new URL(`${prefix}${req.path}`, base);
  if (req.query) target.search = req.query.toString();

  const lookupFn: LookupFunction = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err, '', 4);
      try {
        const list = addresses as dns.LookupAddress[];
        for (const a of list) assertAddressAllowed(a.address, dest, policy);
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
        } else {
          const first = list[0];
          if (!first) return callback(new Error('No addresses'), '', 4);
          callback(null, first.address, first.family);
        }
      } catch (e) {
        callback(e as Error, '', 4);
      }
    });
  };

  const body = req.form ? req.form.toString() : undefined;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'AgiloftControl/0.1',
    ...(body !== undefined
      ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(Buffer.byteLength(body)),
        }
      : {}),
    ...req.headers,
  };

  const lib = target.protocol === 'https:' ? https : http;

  return new Promise<HttpResponse>((resolve, reject) => {
    let bodySent = false;
    let settled = false;
    const fail = (error: AgiloftError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = lib.request(
      target,
      {
        method: req.method,
        headers,
        lookup: lookupFn,
        timeout: req.timeoutMs,
        // Certificate validation stays on; there is no option to disable it.
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > req.maxResponseBytes) {
            res.destroy();
            fail(
              new AgiloftError(
                'response_too_large',
                'The Agiloft response exceeded the configured size limit.',
                {
                  writeOutcome: 'unknown',
                },
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', (cause) =>
          fail(
            new AgiloftError('network', 'Connection to Agiloft was interrupted.', {
              cause,
              writeOutcome: 'unknown',
            }),
          ),
        );
      },
    );

    const overall = setTimeout(() => {
      request.destroy();
      fail(
        new AgiloftError('timeout', `Agiloft did not respond within ${req.timeoutMs} ms.`, {
          writeOutcome: bodySent ? 'unknown' : 'not_sent',
        }),
      );
    }, req.timeoutMs);
    overall.unref();

    request.on('finish', () => {
      bodySent = true;
    });
    request.on('timeout', () => {
      request.destroy();
      fail(
        new AgiloftError('timeout', `Agiloft did not respond within ${req.timeoutMs} ms.`, {
          writeOutcome: bodySent ? 'unknown' : 'not_sent',
        }),
      );
    });
    request.on('error', (cause: NodeJS.ErrnoException) => {
      if (cause instanceof AgiloftError) return fail(cause);
      if (cause && (cause as unknown as AgiloftError).name === 'AgiloftError')
        return fail(cause as unknown as AgiloftError);
      fail(
        new AgiloftError(
          'network',
          `Could not communicate with Agiloft (${cause.code ?? 'network error'}).`,
          {
            cause,
            writeOutcome: bodySent ? 'unknown' : 'not_sent',
          },
        ),
      );
    });
    request.on('close', () => clearTimeout(overall));

    if (body !== undefined) request.write(body);
    request.end();
  });
}

export function parseRetryAfter(value: string | string[] | undefined): number | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return undefined;
  const seconds = Number(v);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(v);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 60_000)) : undefined;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
