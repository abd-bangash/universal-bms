/** @jest-environment node */
import { RefreshCoordinator, type TokenPair } from './refresh-coordinator';

const pair = (n: number): TokenPair => ({
  accessToken: `a${n}`,
  refreshToken: `r${n}`,
  expiresIn: 900,
});

describe('RefreshCoordinator', () => {
  it('shares one refresh among concurrent callers', async () => {
    const coordinator = new RefreshCoordinator();
    const doRefresh = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return pair(1);
    });
    const results = await Promise.all([1, 2, 3].map(() => coordinator.refresh('old', doRefresh)));
    expect(doRefresh).toHaveBeenCalledTimes(1);
    expect(results).toEqual([pair(1), pair(1), pair(1)]);
  });

  it('serves late callers with the old token from the recent result, for 30 seconds', async () => {
    let now = 1_000_000;
    const coordinator = new RefreshCoordinator(() => now);
    const doRefresh = jest.fn(async () => pair(1));
    await coordinator.refresh('old', doRefresh);
    now += 29_000;
    expect(await coordinator.refresh('old', doRefresh)).toEqual(pair(1));
    expect(doRefresh).toHaveBeenCalledTimes(1);
    now += 2_000;
    await coordinator.refresh('old', async () => pair(2));
  });

  it('does not remember failures, and keeps tokens apart', async () => {
    const coordinator = new RefreshCoordinator();
    const failing = jest.fn(async () => null);
    expect(await coordinator.refresh('a', failing)).toBeNull();
    expect(await coordinator.refresh('a', failing)).toBeNull();
    expect(failing).toHaveBeenCalledTimes(2);
    expect(await coordinator.refresh('b', async () => pair(9))).toEqual(pair(9));
  });

  it('lets a rejected refresh be tried again', async () => {
    const coordinator = new RefreshCoordinator();
    await expect(
      coordinator.refresh('a', async () => Promise.reject(new Error('down'))),
    ).rejects.toThrow('down');
    expect(await coordinator.refresh('a', async () => pair(3))).toEqual(pair(3));
  });
});
