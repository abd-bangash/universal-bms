import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { failure, jsonResponse, mockApi, renderWithProviders } from '@/test/render';
import type { SettingsSnapshot } from '@/lib/hooks/use-settings';
import { BusinessForm } from './business-form';

const numbering = (prefix: string, padding = 4) => ({ prefix, includeYear: true, padding });
const snapshot: SettingsSnapshot = {
  configVersion: 3,
  config: {
    business: { legalName: 'Acme Furniture', phone: '+92 300 0000000' },
    branding: {},
    locale: {
      currency: 'PKR',
      currencyDecimals: 2,
      timezone: 'Asia/Karachi',
      language: 'en',
      dateFormat: 'DD/MM/YYYY',
    },
    modules: {},
    tax: { enabled: false, pricesIncludeTax: false },
    numbering: {
      QUOTATION: numbering('QT-'),
      ORDER: numbering('ORD-'),
      INVOICE: numbering('INV-'),
      RECEIPT: numbering('RCP-', 5),
      REFUND_RECEIPT: numbering('RFD-'),
      PURCHASE_ORDER: numbering('PO-'),
      GOODS_RECEIPT: numbering('GRN-'),
      RETURN: numbering('RET-'),
      PAYMENT: numbering('PAY-', 5),
    },
    documents: { receiptPaper: '80mm', showBankDetails: true, quotationValidityDays: 14 },
    sales: { requiredDepositPercent: 50, discountOverLimit: 'REJECT' },
  },
};

const configurer = { permissions: ['workspace:view', 'workspace:configure'] };
const year = new Date().getFullYear();

describe('BusinessForm (task 14)', () => {
  it('shows the current settings', () => {
    renderWithProviders(<BusinessForm snapshot={snapshot} />, { session: configurer });
    expect(screen.getByLabelText('Business name')).toHaveValue('Acme Furniture');
    expect(screen.getByLabelText('Phone')).toHaveValue('+92 300 0000000');
    expect(screen.getByLabelText('Currency (ISO code)')).toHaveValue('PKR');
    expect(screen.getByLabelText('Timezone')).toHaveValue('Asia/Karachi');
    expect(screen.getByLabelText('Receipt paper size')).toHaveValue('80mm');
    expect(screen.getByLabelText('Required deposit before production (%)')).toHaveValue(50);
  });

  it('shows what each document number will look like and updates it as the format is edited', async () => {
    renderWithProviders(<BusinessForm snapshot={snapshot} />, { session: configurer });
    expect(screen.getByText(`QT-${year}-0001`)).toBeInTheDocument();
    expect(screen.getByText(`RCP-${year}-00001`)).toBeInTheDocument();
    const prefix = screen.getByLabelText('Quotation Prefix');
    await userEvent.clear(prefix);
    await userEvent.type(prefix, 'Q/');
    await userEvent.click(screen.getByLabelText('Quotation Include the year'));
    expect(screen.getByText('Q/0001')).toBeInTheDocument();
  });

  it('saves the edited sections and shows the confirmation', async () => {
    const { calls } = mockApi({
      'PATCH /settings': ({ body }) => ({
        configVersion: 4,
        config: {
          ...snapshot.config,
          ...(body as object),
          business: { ...snapshot.config.business, ...(body as { business: object }).business },
        },
      }),
    });
    renderWithProviders(<BusinessForm snapshot={snapshot} />, { session: configurer });
    await userEvent.clear(screen.getByLabelText('Business name'));
    await userEvent.type(screen.getByLabelText('Business name'), 'Acme Interiors');
    await userEvent.clear(screen.getByLabelText('Required deposit before production (%)'));
    await userEvent.type(screen.getByLabelText('Required deposit before production (%)'), '30');
    await userEvent.selectOptions(screen.getByLabelText('Receipt paper size'), 'A4');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();

    const body = calls.find((c) => c.method === 'PATCH')?.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.business.legalName).toBe('Acme Interiors');
    expect(body.sales).toEqual({ requiredDepositPercent: 30, discountOverLimit: 'REJECT' });
    expect(body.documents.receiptPaper).toBe('A4');
    expect(body.locale.currencyDecimals).toBe(2); // numbers stay numbers
    expect(body.numbering.RECEIPT.padding).toBe(5);
    expect(Object.keys(body).sort()).toEqual([
      'branding',
      'business',
      'documents',
      'locale',
      'numbering',
      'sales',
      'tax',
    ]);
  });

  it('clears an optional value by sending it empty', async () => {
    const { calls } = mockApi({ 'PATCH /settings': () => snapshot });
    renderWithProviders(<BusinessForm snapshot={snapshot} />, { session: configurer });
    await userEvent.clear(screen.getByLabelText('Phone'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Settings saved.');
    expect(
      (calls.find((c) => c.method === 'PATCH')?.body as { business: { phone: string } }).business
        .phone,
    ).toBe('');
  });

  it('shows the server’s messages against the right field (by their setting path)', async () => {
    mockApi({
      'PATCH /settings': () =>
        failure(400, 'VALIDATION_FAILED', {
          'locale.timezone': ['must be a valid IANA timezone'],
          'sales.requiredDepositPercent': ['Too big: expected number to be <=100'],
        }),
    });
    renderWithProviders(<BusinessForm snapshot={snapshot} />, { session: configurer });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('must be a valid IANA timezone')).toBeInTheDocument();
    expect(screen.getByText('Too big: expected number to be <=100')).toBeInTheDocument();
    expect(screen.getByLabelText('Timezone')).toHaveAttribute('aria-invalid', 'true');
  });

  it('is read-only for people who may view but not configure', () => {
    renderWithProviders(<BusinessForm snapshot={snapshot} />, {
      session: { permissions: ['workspace:view'] },
    });
    expect(
      screen.getByText('You can view these settings but not change them.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Business name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByText('Choose a file')).not.toBeInTheDocument();
  });

  it('sets the logo from an upload and can remove it', async () => {
    const { calls } = mockApi({
      'POST /files': () => ({
        id: 'file_1',
        name: 'logo.png',
        mime: 'image/png',
        size: 5,
        hasThumbnail: true,
      }),
      'PATCH /settings': ({ body }) => ({
        configVersion: 4,
        config: { ...snapshot.config, branding: (body as { branding: object }).branding },
      }),
    });
    renderWithProviders(<BusinessForm snapshot={snapshot} />, { session: configurer });
    expect(screen.getByText('No logo yet.')).toBeInTheDocument();
    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'], 'logo.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('A logo is set.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Settings saved.');
    expect(
      (calls.find((c) => c.method === 'PATCH')?.body as { branding: { logoFileId: string } })
        .branding.logoFileId,
    ).toBe('file_1');

    await userEvent.click(screen.getByRole('button', { name: 'Remove logo' }));
    expect(screen.getByText('No logo yet.')).toBeInTheDocument();
  });

  it('lists a document-number row for every document type', () => {
    renderWithProviders(<BusinessForm snapshot={snapshot} />, { session: configurer });
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(10); // header + nine types
  });
});

// keeps the unused import honest for failure() style helpers
void jsonResponse;
void waitFor;
