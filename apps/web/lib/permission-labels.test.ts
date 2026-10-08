import { PERMISSION_CATALOGUE } from '@bms/types';
import messages from '../messages/en.json';

describe('permission labels', () => {
  it('has a plain-language label for every resource and action in the catalogue (the role editor shows them)', () => {
    const labels = messages.permissions as {
      resources: Record<string, string>;
      actions: Record<string, string>;
    };
    const missingResources = Object.keys(PERMISSION_CATALOGUE).filter(
      (r) => r !== 'platform' && !labels.resources[r],
    );
    const actions = new Set(
      Object.entries(PERMISSION_CATALOGUE)
        .filter(([r]) => r !== 'platform')
        .flatMap(([, a]) => [...a]),
    );
    const missingActions = [...actions].filter((a) => !labels.actions[a]);
    expect(missingResources).toEqual([]);
    expect(missingActions).toEqual([]);
  });
});
