import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { jsonResponse, mockFetch, renderWithProviders } from '@/test/render';
import { DynamicFields, type FieldDefinitionView, type FieldValues } from './dynamic-fields';

const units = [
  { symbol: 'ft', name: 'Foot', dimension: 'length' },
  { symbol: 'm', name: 'Metre', dimension: 'length' },
  { symbol: 'kg', name: 'Kilogram', dimension: 'weight' },
];

const definitions: FieldDefinitionView[] = [
  {
    key: 'size_type',
    label: 'Size type',
    type: 'DROPDOWN',
    options: [
      { key: 'standard', label: 'Standard' },
      { key: 'custom', label: 'Custom' },
    ],
    sortOrder: 0,
  },
  {
    key: 'length',
    label: 'Length',
    type: 'MEASUREMENT',
    unitDimension: 'length',
    defaultUnit: 'ft',
    visibleWhen: { source: 'field', key: 'size_type', op: 'eq', value: 'custom' },
    sortOrder: 10,
  },
  { key: 'color', label: 'Colour', type: 'TEXT', required: true, sortOrder: 20 },
  { key: 'qty', label: 'Quantity', type: 'NUMBER', sortOrder: 30 },
  { key: 'delivery', label: 'Delivery date', type: 'DATE', sortOrder: 40 },
  { key: 'gift', label: 'Gift wrap', type: 'BOOLEAN', sortOrder: 50 },
  {
    key: 'tags',
    label: 'Finishes',
    type: 'MULTI_SELECT',
    options: [
      { key: 'matte', label: 'Matte' },
      { key: 'gloss', label: 'Gloss' },
    ],
    sortOrder: 60,
  },
  { key: 'deposit', label: 'Deposit', type: 'CURRENCY', sortOrder: 70 },
  { key: 'old', label: 'Retired field', type: 'TEXT', active: false },
];

function Harness({
  initial = {},
  errors,
  context,
}: {
  initial?: FieldValues;
  errors?: Record<string, string>;
  context?: { categoryId?: string };
}) {
  const [values, setValues] = useState<FieldValues>(initial);
  return (
    <>
      <DynamicFields
        definitions={definitions}
        values={values}
        onChange={setValues}
        errors={errors}
        units={units}
        context={context}
      />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </>
  );
}

const current = () => JSON.parse(screen.getByTestId('values').textContent ?? '{}') as FieldValues;

describe('DynamicFields (Requirements 49.11, 26.4)', () => {
  it('renders active fields in display order with labelled controls, and skips retired ones', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByLabelText('Size type')).toBeInTheDocument();
    expect(screen.getByLabelText(/Colour/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Retired field')).not.toBeInTheDocument();
    const labels = screen.getAllByText(/.+/, { selector: 'label' }).map((l) => l.textContent);
    expect(labels.indexOf('Size type')).toBeLessThan(
      labels.findIndex((l) => l?.startsWith('Colour')),
    );
  });

  it('shows a conditional field only while its condition holds (the custom-size dimensions)', async () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByText('Length')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Size type'), 'custom');
    expect(screen.getByText('Length')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Size type'), 'standard');
    expect(screen.queryByText('Length')).not.toBeInTheDocument();
  });

  it('marks required fields', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByText('Colour').parentElement).toHaveTextContent('Colour *');
  });

  it('edits text, number (decimal text only), date and boolean values', async () => {
    renderWithProviders(<Harness />);
    await userEvent.type(screen.getByLabelText(/Colour/), 'Walnut');
    await userEvent.type(screen.getByLabelText('Quantity'), '3x.5');
    await userEvent.type(screen.getByLabelText('Delivery date'), '2026-12-01');
    await userEvent.click(screen.getByLabelText('Gift wrap'));
    expect(current()).toMatchObject({
      color: 'Walnut',
      qty: '3.5',
      delivery: '2026-12-01',
      gift: true,
    });
  });

  it('chooses from dropdown options and toggles multi-select options', async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByLabelText('Matte'));
    await userEvent.click(screen.getByLabelText('Gloss'));
    await userEvent.click(screen.getByLabelText('Matte'));
    expect(current().tags).toEqual(['gloss']);
  });

  it('captures a measurement as value and unit, offering only units of its dimension', async () => {
    renderWithProviders(<Harness initial={{ size_type: 'custom' }} />);
    const unit = screen.getByLabelText('Length Unit');
    expect(
      within(unit)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['ft', 'm']);
    expect(unit).toHaveValue('ft'); // the field's default unit
    await userEvent.type(screen.getByLabelText('Length Value'), '8');
    await userEvent.selectOptions(unit, 'm');
    expect(current().length).toEqual({ value: '8', unit: 'm' });
  });

  it('keeps money as a decimal string tidied to the currency decimals', async () => {
    renderWithProviders(<Harness />);
    await userEvent.type(screen.getByLabelText('Deposit'), '250.5');
    await userEvent.tab();
    expect(current().deposit).toBe('250.50');
  });

  it('shows messages against the right field and links them for screen readers', () => {
    renderWithProviders(<Harness errors={{ color: 'Colour is required' }} />);
    const input = screen.getByLabelText(/Colour/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'cf-color-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Colour is required');
  });

  it('applies a category scope', () => {
    const scoped: FieldDefinitionView[] = [
      { key: 'seats', label: 'Seats', type: 'NUMBER', categoryId: 'sofas' },
    ];
    const { rerender } = renderWithProviders(
      <DynamicFields
        definitions={scoped}
        values={{}}
        onChange={jest.fn()}
        context={{ categoryId: 'beds' }}
      />,
    );
    expect(screen.queryByLabelText('Seats')).not.toBeInTheDocument();
    rerender(
      <DynamicFields
        definitions={scoped}
        values={{}}
        onChange={jest.fn()}
        context={{ categoryId: 'sofas' }}
      />,
    );
    expect(screen.getByLabelText('Seats')).toBeInTheDocument();
  });

  it('uploads an image field through the file endpoint and stores the file id', async () => {
    mockFetch(() =>
      jsonResponse(
        { data: { id: 'file_9', name: 'ref.png', mime: 'image/png', size: 3, hasThumbnail: true } },
        201,
      ),
    );
    function ImageHarness() {
      const [values, setValues] = useState<FieldValues>({});
      return (
        <>
          <DynamicFields
            definitions={[{ key: 'photo', label: 'Reference image', type: 'IMAGE' }]}
            values={values}
            onChange={setValues}
          />
          <output data-testid="values">{JSON.stringify(values)}</output>
        </>
      );
    }
    renderWithProviders(<ImageHarness />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['png'], 'ref.png', { type: 'image/png' }));
    expect(await screen.findByText('Uploaded: ref.png')).toBeInTheDocument();
    expect(current()).toEqual({ photo: 'file_9' });
  });
});
