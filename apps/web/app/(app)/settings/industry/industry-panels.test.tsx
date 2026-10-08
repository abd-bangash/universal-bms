import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { failure, mockApi, renderWithProviders } from '@/test/render';
import { ModulesPanel } from './modules-panel';
import { ProfilePanel } from './profile-panel';
import { TaxPanel, ratePercent } from './tax-panel';
import { UnitsPanel } from './units-panel';

const configurer = { permissions: ['workspace:view', 'workspace:configure'] };
const viewer = { permissions: ['workspace:view'] };

describe('ProfilePanel', () => {
  const routes = (applyResult: unknown = { fieldDefinitions: 2, states: 1, units: 0 }) => ({
    'GET /settings/industry-profiles': () => [
      { key: 'furniture', name: 'Furniture', isCurrent: true },
    ],
    'POST /settings/apply-profile/furniture': () => applyResult,
  });

  it('shows the current profile and applies it again after a confirmation', async () => {
    const { calls } = mockApi(routes());
    renderWithProviders(<ProfilePanel />, { session: configurer });
    expect(await screen.findByText('Current profile: Furniture')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Apply profile' }));
    const dialog = screen.getByRole('dialog', { name: 'Apply the “Furniture” profile?' });
    expect(within(dialog).getByText(/Nothing you added or changed is removed/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply profile' }));
    expect(
      await screen.findByText('Profile applied. Added 2 fields, 1 statuses and 0 units.'),
    ).toBeInTheDocument();
    expect(
      calls.some((c) => c.method === 'POST' && c.path === '/settings/apply-profile/furniture'),
    ).toBe(true);
  });

  it('does not offer to apply a profile without permission', async () => {
    mockApi(routes());
    renderWithProviders(<ProfilePanel />, { session: viewer });
    await screen.findByText('Current profile: Furniture');
    expect(screen.queryByRole('button', { name: 'Apply profile' })).not.toBeInTheDocument();
  });
});

describe('ModulesPanel (Requirement 5.3)', () => {
  const settings = {
    configVersion: 1,
    config: { modules: { pos: true, purchasing: true, ai: false } },
  };

  it('shows each module and switches one off immediately', async () => {
    const { calls } = mockApi({
      'GET /settings': () => settings,
      'PATCH /settings': ({ body }) => ({
        configVersion: 2,
        config: {
          modules: { ...settings.config.modules, ...(body as { modules: object }).modules },
        },
      }),
      'GET /auth/me': () => ({}),
    });
    renderWithProviders(<ModulesPanel />, { session: configurer });
    const pos = await screen.findByLabelText('Point of sale');
    await waitFor(() => expect(pos).toBeChecked());
    expect(screen.getByLabelText('AI assistant')).not.toBeChecked();
    await userEvent.click(pos);
    await waitFor(() => expect(screen.getByLabelText('Point of sale')).not.toBeChecked());
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ modules: { pos: false } });
  });

  it('is read-only without the configure permission', async () => {
    mockApi({ 'GET /settings': () => settings });
    renderWithProviders(<ModulesPanel />, { session: viewer });
    const pos = await screen.findByLabelText('Point of sale');
    expect(pos).toBeDisabled();
  });

  it('shows the server’s refusal', async () => {
    mockApi({
      'GET /settings': () => settings,
      'PATCH /settings': () => failure(403, 'PERMISSION_DENIED'),
    });
    renderWithProviders(<ModulesPanel />, { session: configurer });
    const pos = await screen.findByLabelText('Point of sale');
    await waitFor(() => expect(pos).toBeEnabled());
    await userEvent.click(pos);
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
  });
});

describe('UnitsPanel', () => {
  const units = [
    { id: 'u1', name: 'Foot', symbol: 'ft', dimension: 'length', toBase: '0.3048' },
    { id: 'u2', name: 'Piece', symbol: 'pc', dimension: 'count', toBase: '1' },
  ];

  it('lists units and adds one with an exact decimal factor', async () => {
    const { calls } = mockApi({
      'GET /settings/units': () => units,
      'POST /settings/units': ({ body }) => ({ id: 'u3', ...(body as object) }),
    });
    renderWithProviders(<UnitsPanel />, { session: configurer });
    expect(await screen.findByText('Foot')).toBeInTheDocument();
    expect(screen.getByText('0.3048')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Yard');
    await userEvent.type(screen.getByLabelText('Symbol'), 'yd');
    await userEvent.clear(screen.getByLabelText('Factor to base unit'));
    await userEvent.type(screen.getByLabelText('Factor to base unit'), '0.9144');
    await userEvent.click(screen.getByRole('button', { name: 'Add unit' }));
    expect(await screen.findByText('Unit added.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Yard',
      symbol: 'yd',
      dimension: 'length',
      toBase: '0.9144',
    });
  });

  it('shows the server’s message when the symbol already exists', async () => {
    mockApi({
      'GET /settings/units': () => units,
      'POST /settings/units': () =>
        failure(400, 'VALIDATION_FAILED', { symbol: ['a unit with this symbol already exists'] }),
    });
    renderWithProviders(<UnitsPanel />, { session: configurer });
    await screen.findByText('Foot');
    await userEvent.type(screen.getByLabelText('Name'), 'Foot 2');
    await userEvent.type(screen.getByLabelText('Symbol'), 'ft');
    await userEvent.click(screen.getByRole('button', { name: 'Add unit' }));
    expect(await screen.findByText('a unit with this symbol already exists')).toBeInTheDocument();
  });

  it('hides the form from people who cannot configure', async () => {
    mockApi({ 'GET /settings/units': () => units });
    renderWithProviders(<UnitsPanel />, { session: viewer });
    await screen.findByText('Foot');
    expect(screen.queryByRole('button', { name: 'Add unit' })).not.toBeInTheDocument();
  });
});

describe('TaxPanel', () => {
  it('computes percentages with decimals, never floats', () => {
    expect(ratePercent('0.1700')).toBe('17');
    expect(ratePercent('0.175')).toBe('17.5');
    expect(ratePercent('0.0001')).toBe('0.01');
    expect(ratePercent('1')).toBe('100');
  });

  it('lists, adds and deactivates tax classes', async () => {
    const taxes = [{ id: 't1', name: 'GST', rate: '0.17', active: true }];
    const { calls } = mockApi({
      'GET /settings/tax-classes': () => taxes,
      'POST /settings/tax-classes': ({ body }) => ({ id: 't2', active: true, ...(body as object) }),
      'PATCH /settings/tax-classes/t1': ({ body }) => ({ ...taxes[0], ...(body as object) }),
    });
    renderWithProviders(<TaxPanel />, { session: configurer });
    expect(await screen.findByText('GST · 17%')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('GST Active'));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'PATCH' && JSON.stringify(c.body) === '{"active":false}'),
      ).toBe(true),
    );

    await userEvent.type(screen.getByLabelText('Name'), 'Reduced');
    await userEvent.type(screen.getByLabelText('Rate (e.g. 0.17 for 17%)'), '0.05');
    await userEvent.click(screen.getByRole('button', { name: 'Add tax class' }));
    expect(await screen.findByText('Tax class added.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Reduced', rate: '0.05' });
  });
});
