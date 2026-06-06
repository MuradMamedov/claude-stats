import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import { parseRateHeaders, RateInfo } from './logic';

export interface OauthCreds {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export function defaultCredentialsPath(): string {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

export function readCredentials(filePath: string): OauthCreds | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.claudeAiOauth ?? null;
  } catch {
    return null;
  }
}

export type FetchResult =
  | { ok: true; info: RateInfo }
  | { ok: false; kind: 'noauth' | 'expired' | 'offline' };

export function fetchRateInfo(credentialsPath: string): Promise<FetchResult> {
  return new Promise((resolve) => {
    const creds = readCredentials(credentialsPath);
    if (!creds?.accessToken) {
      resolve({ ok: false, kind: 'noauth' });
      return;
    }
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }]
    });
    const req = https.request(
      {
        host: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${creds.accessToken}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
          'content-length': Buffer.byteLength(body)
        }
      },
      (res) => {
        // Drain the body; we only need the headers.
        res.on('data', () => undefined);
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status === 401) {
            resolve({ ok: false, kind: 'expired' });
          } else if (status >= 200 && status < 300) {
            resolve({ ok: true, info: parseRateHeaders(res.headers) });
          } else {
            resolve({ ok: false, kind: 'offline' });
          }
        });
      }
    );
    req.on('error', () => resolve({ ok: false, kind: 'offline' }));
    req.write(body);
    req.end();
  });
}
