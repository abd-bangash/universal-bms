import { renderTemplate, variablesOf } from '../template-render';

describe('template rendering', () => {
  it('lists placeholders once each, in order, tolerating spaces', () => {
    expect(
      variablesOf('Hi {{customer_name}}, {{ order_total }} and {{customer_name}} again'),
    ).toEqual(['customer_name', 'order_total']);
    expect(variablesOf('no placeholders')).toEqual([]);
  });

  it('fills every placeholder it has a value for', () => {
    expect(
      renderTemplate('Dear {{customer_name}}, total {{order_total}}', {
        customer_name: 'Sana',
        order_total: 'Rs 2,000',
      }),
    ).toEqual({
      text: 'Dear Sana, total Rs 2,000',
      unresolved: [],
    });
  });

  it('reports a placeholder with no value or a blank one, and never leaves it looking filled', () => {
    const out = renderTemplate('{{customer_name}} owes {{balance_due}} {{balance_due}}', {
      customer_name: 'Sana',
      balance_due: '  ',
    });
    expect(out.unresolved).toEqual(['balance_due']);
    expect(out.text).not.toContain('{{');
  });
});
