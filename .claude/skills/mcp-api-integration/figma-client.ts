// Figma REST client. Node 18+ (native fetch), no dependencies.
//   FIGMA_TOKEN=<personal access token> npx tsx figma-client.ts
// An OAuth access token works too — pass tokenType: 'oauth'.

const BASE = 'https://api.figma.com';
const MAX_BACKOFF_MS = 60_000; // Figma has returned Retry-After values of days. Cap it.
const MAX_RETRIES = 4;

type TokenType = 'pat' | 'oauth';

export interface FigmaRef {
  fileKey: string;
  nodeId: string | null;
}

/** Node ids arrive hyphenated in URLs and are colon-separated everywhere else. */
export function parseFigmaUrl(url: string): FigmaRef {
  const u = new URL(url);
  const fileKey = u.pathname.split('/')[2];
  if (!fileKey) throw new Error(`no fileKey in ${url}`);
  const raw = u.searchParams.get('node-id');
  return { fileKey, nodeId: raw ? raw.replace(/-/g, ':') : null };
}

export class RateLimited extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`rate limited; Figma asked for ${retryAfterSeconds}s`);
  }
}

export class FigmaClient {
  constructor(
    private token = process.env.FIGMA_TOKEN ?? '',
    private tokenType: TokenType = 'pat',
  ) {
    if (!this.token) throw new Error('set FIGMA_TOKEN');
  }

  private headers(): Record<string, string> {
    // Crossing these returns 403, which reads as a file-permission problem.
    return this.tokenType === 'oauth'
      ? { Authorization: `Bearer ${this.token}` }
      : { 'X-Figma-Token': this.token };
  }

  private async get<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE}${path}`, { headers: this.headers() });
      if (res.ok) return (await res.json()) as T;

      if (res.status === 429) {
        const asked = Number(res.headers.get('retry-after') ?? 0);
        // Past the cap the budget is genuinely gone; retrying eats the next window.
        if (asked * 1000 > MAX_BACKOFF_MS || attempt >= MAX_RETRIES) throw new RateLimited(asked);
        await sleep(Math.max(asked * 1000, 2 ** attempt * 1000));
        continue;
      }
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
    }
  }

  /** Cheapest call that proves the token works. Run it before anything long. */
  me() {
    return this.get<{ id: string; email: string; handle: string }>('/v1/me');
  }

  /** `depth` keeps a large design file from arriving whole. */
  file(key: string, opts: { depth?: number; ids?: string[] } = {}) {
    const q = new URLSearchParams();
    if (opts.depth) q.set('depth', String(opts.depth));
    if (opts.ids?.length) q.set('ids', opts.ids.join(','));
    return this.get<any>(`/v1/files/${key}${q.size ? `?${q}` : ''}`);
  }

  /** Specific subtrees. Much smaller than the whole file. */
  nodes(key: string, ids: string[], depth?: number) {
    const q = new URLSearchParams({ ids: ids.join(',') });
    if (depth) q.set('depth', String(depth));
    return this.get<any>(`/v1/files/${key}/nodes?${q}`);
  }

  /** Returns short-lived URLs, not image bytes. Fetch them promptly. */
  images(key: string, ids: string[], format: 'png' | 'svg' | 'jpg' | 'pdf' = 'svg', scale = 1) {
    const q = new URLSearchParams({ ids: ids.join(','), format, scale: String(scale) });
    return this.get<{ images: Record<string, string | null>; err: string | null }>(
      `/v1/images/${key}?${q}`,
    );
  }

  versions(key: string) {
    return this.get<any>(`/v1/files/${key}/versions`);
  }

  comments(key: string) {
    return this.get<any>(`/v1/files/${key}/comments`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (require.main === module) {
  (async () => {
    const client = new FigmaClient();
    const me = await client.me();
    console.log(JSON.stringify({ authenticated_as: me.handle, email: me.email }, null, 2));

    const url = process.argv[2];
    if (!url) return console.log('pass a Figma URL to read a node');

    const { fileKey, nodeId } = parseFigmaUrl(url);
    console.log(JSON.stringify({ fileKey, nodeId }, null, 2));
    const data = nodeId
      ? await client.nodes(fileKey, [nodeId], 2)
      : await client.file(fileKey, { depth: 1 });
    console.log(JSON.stringify(data, null, 2).slice(0, 1500));
  })().catch((e) => {
    console.error('FAILED', e.message);
    process.exit(1);
  });
}
