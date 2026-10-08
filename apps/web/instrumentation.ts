import { readWebEnv } from '@/lib/env';

export function register(): void {
  readWebEnv(); // fail at server start, not at first request
}
