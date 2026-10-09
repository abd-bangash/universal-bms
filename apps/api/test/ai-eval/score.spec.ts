import { EVAL_CONVERSATIONS } from './conversations';
import { normalizeValue, scoreConversation, summarize } from './score';

const conv = (fields: Record<string, string>, product?: string) => ({
  id: 'x',
  expected: { fields, ...(product ? { product } : {}) },
});

describe('eval scoring', () => {
  it('counts details with the expected value, ignoring case and punctuation', () => {
    const s = scoreConversation(
      conv({ color: 'Brown', length: '8 feet' }, 'SOF-001'),
      [
        { key: 'color', value: 'brown.', level: 'HIGH' },
        { key: 'length', value: '8  Feet', level: 'MEDIUM' },
      ],
      ['SOF-001'],
    );
    expect(s).toEqual({ id: 'x', expected: 3, correct: 3, missed: [], wrong: [] });
  });

  it('ignores LOW details: they are not trusted, so they are neither right nor wrong', () => {
    const s = scoreConversation(
      conv({ interest: 'sofa' }),
      [
        { key: 'interest', value: 'sofa', level: 'HIGH' },
        { key: 'color', value: 'red', level: 'LOW' },
      ],
      [],
    );
    expect(s).toMatchObject({ expected: 1, correct: 1, wrong: [] });
    // an expected detail that came back only as LOW is missed
    expect(
      scoreConversation(conv({ color: 'red' }), [{ key: 'color', value: 'red', level: 'LOW' }], [])
        .missed,
    ).toEqual(['color']);
  });

  it('counts a confident wrong value, an unasked-for detail and a wrong product against the extraction', () => {
    const s = scoreConversation(
      conv({ color: 'grey' }, 'CHR-005'),
      [
        { key: 'color', value: 'black', level: 'HIGH' },
        { key: 'material', value: 'wood', level: 'MEDIUM' },
      ],
      ['CHR-001'],
    );
    expect(s.correct).toBe(0);
    expect(s.missed).toEqual(['product']);
    expect(s.wrong).toEqual(['color=black', 'material=wood', 'product=CHR-001']);
  });

  it('expects nothing from a conversation with nothing in it, and flags anything made up', () => {
    expect(scoreConversation(conv({}), [], [])).toEqual({
      id: 'x',
      expected: 0,
      correct: 0,
      missed: [],
      wrong: [],
    });
    expect(
      scoreConversation(conv({}), [{ key: 'color', value: 'red', level: 'HIGH' }], ['SOF-001'])
        .wrong,
    ).toEqual(['color=red', 'product=SOF-001']);
  });

  it('summarises accuracy over all details', () => {
    const report = summarize([
      { id: 'a', expected: 4, correct: 4, missed: [], wrong: [] },
      { id: 'b', expected: 6, correct: 3, missed: ['x'], wrong: ['y=1'] },
    ]);
    expect(report).toMatchObject({
      conversations: 2,
      expected: 10,
      correct: 7,
      accuracy: 0.7,
      wrong: 1,
    });
    expect(summarize([]).accuracy).toBe(1);
  });

  it('normalises values the way the comparison does', () => {
    expect(normalizeValue('  L-Shaped   Sofa! ')).toBe('l shaped sofa');
  });
});

describe('the evaluation set', () => {
  it('has at least 20 conversations with unique ids, each with something to read', () => {
    expect(EVAL_CONVERSATIONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(EVAL_CONVERSATIONS.map((c) => c.id)).size).toBe(EVAL_CONVERSATIONS.length);
    for (const c of EVAL_CONVERSATIONS) {
      expect(c.messages.some((m) => m.from === 'CUSTOMER')).toBe(true);
    }
  });
});
