export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const RECENT_MS = 30_000;

/**
 * Refresh tokens rotate and reuse revokes the session (design "Refresh token"). A page that fires
 * several requests as its access token expires would otherwise present the same refresh token
 * several times and sign itself out. This makes concurrent requests share ONE refresh, and lets
 * a request that was already on its way with the old token pick up the new pair for a short while.
 */
export class RefreshCoordinator {
  private readonly inflight = new Map<string, Promise<TokenPair | null>>();
  private readonly recent = new Map<string, { pair: TokenPair; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async refresh(
    refreshToken: string,
    doRefresh: (token: string) => Promise<TokenPair | null>,
  ): Promise<TokenPair | null> {
    this.evict();
    const done = this.recent.get(refreshToken);
    if (done) return done.pair;
    const running = this.inflight.get(refreshToken);
    if (running) return running;

    const attempt = doRefresh(refreshToken)
      .then((pair) => {
        if (pair) this.recent.set(refreshToken, { pair, expiresAt: this.now() + RECENT_MS });
        return pair;
      })
      .finally(() => this.inflight.delete(refreshToken));
    this.inflight.set(refreshToken, attempt);
    return attempt;
  }

  private evict(): void {
    const now = this.now();
    for (const [token, entry] of this.recent) if (entry.expiresAt <= now) this.recent.delete(token);
  }
}
