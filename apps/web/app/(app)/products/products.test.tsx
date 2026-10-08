import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { failure, mockApi, page, renderWithProviders } from '@/test/render';
import type { ProductView, VariantView } from '@/lib/hooks/use-catalog';
import { BrandManager } from './brand-manager';
import { CategoryManager } from './category-manager';
import { ProductEditor } from './product-editor';
import { ProductForm } from './product-form';
import { ProductList } from './product-list';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/products',
}));

const variant = (over: Partial<VariantView> = {}): VariantView => ({
  id: 'v1',
  productId: 'p1',
  sku: 'SOFA-1',
  barcode: '5000',
  name: null,
  isDefault: true,
  priceOverride: null,
  costOverride: '600',
  weight: null,
  minStockLevel: '2',
  maxStockLevel: null,
  status: 'ACTIVE',
  customFields: {},
  ...over,
});

const product = (over: Partial<ProductView> = {}): ProductView => ({
  id: 'p1',
  code: 'SOFA-1',
  name: 'Corner Sofa',
  description: null,
  categoryId: 'c-sofas',
  brandId: null,
  type: 'STOCKABLE',
  status: 'ACTIVE',
  madeToOrder: false,
  tracking: 'NONE',
  baseUnitId: null,
  saleUnitId: null,
  purchaseUnitId: null,
  basePrice: '1000',
  costPrice: '600',
  taxClassId: null,
  tags: [],
  aliases: ['couch'],
  visibleInPos: true,
  visibleToAi: true,
  customFields: { wood: 'oak' },
  version: 3,
  variants: [variant()],
  images: [],
  ...over,
});

const tree = [
  {
    id: 'c-living',
    name: 'Living',
    parentId: null,
    sortOrder: 0,
    active: true,
    children: [
      {
        id: 'c-sofas',
        name: 'Sofas',
        parentId: 'c-living',
        sortOrder: 0,
        active: true,
        children: [],
      },
    ],
  },
];

const productFields = [
  {
    id: 'f1',
    key: 'wood',
    label: 'Wood',
    type: 'DROPDOWN',
    options: [
      { key: 'oak', label: 'Oak' },
      { key: 'teak', label: 'Teak' },
    ],
    required: false,
    isVariantAxis: false,
    sortOrder: 0,
    active: true,
  },
  {
    id: 'f2',
    key: 'seats',
    label: 'Seats',
    type: 'NUMBER',
    required: true,
    isVariantAxis: false,
    sortOrder: 1,
    active: true,
    categoryId: 'c-living',
  },
];
const variantFields = [
  {
    id: 'f3',
    key: 'tone',
    label: 'Tone',
    type: 'DROPDOWN',
    options: [
      { key: 'red', label: 'Red' },
      { key: 'blue', label: 'Blue' },
    ],
    isVariantAxis: true,
    sortOrder: 0,
    active: true,
  },
];

const manager = {
  permissions: [
    'product:view',
    'product:create',
    'product:edit',
    'product:archive',
    'product:view_cost',
  ],
};

function routes(extra: Record<string, () => unknown> = {}) {
  return mockApi({
    'GET /catalog/categories': () => tree,
    'GET /catalog/brands': () => [{ id: 'b1', name: 'Acme', active: true }],
    'GET /fields': () => productFields,
    'GET /settings/units': () => [{ id: 'u1', name: 'Piece', symbol: 'pc', dimension: 'count' }],
    'GET /settings/tax-classes': () => [{ id: 't1', name: 'Standard', rate: '0.17', active: true }],
    ...extra,
  });
}

describe('ProductList', () => {
  const rows = [
    product(),
    product({ id: 'p2', code: 'BED', name: 'Oak Bed', status: 'ARCHIVED', categoryId: null }),
  ];

  it('lists products with category, price and status, and links to the editor', async () => {
    routes({ 'GET /catalog/products': () => page(rows, { total: 2 }) });
    renderWithProviders(<ProductList />, { session: manager });
    const link = await screen.findByRole('link', { name: 'Corner Sofa' });
    expect(link).toHaveAttribute('href', '/products/p1');
    const table = screen.getByRole('table');
    expect(await within(table).findByText('Sofas')).toBeInTheDocument();
    expect(within(table).getByText('Archived')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New Product/ })).toBeInTheDocument();
  });

  it('filters by category, brand, status and custom-field value through the API', async () => {
    const { calls } = routes({ 'GET /catalog/products': () => page(rows) });
    renderWithProviders(<ProductList />, { session: manager });
    await screen.findByRole('link', { name: 'Corner Sofa' });
    await userEvent.selectOptions(await screen.findByLabelText('Category'), 'c-sofas');
    await waitFor(() => expect(calls.at(-1)?.query.get('categoryId')).toBe('c-sofas'));
    await userEvent.selectOptions(screen.getByLabelText('Brand'), 'b1');
    await waitFor(() => expect(calls.at(-1)?.query.get('brandId')).toBe('b1'));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ARCHIVED');
    await waitFor(() => expect(calls.at(-1)?.query.get('status')).toBe('ARCHIVED'));
    await userEvent.selectOptions(await screen.findByLabelText('Wood'), 'teak');
    await waitFor(() => expect(calls.at(-1)?.query.get('cf.wood')).toBe('teak'));
  });

  it('hides the create button from people who may not create', async () => {
    routes({ 'GET /catalog/products': () => page(rows) });
    renderWithProviders(<ProductList />, { session: { permissions: ['product:view'] } });
    await screen.findByRole('link', { name: 'Corner Sofa' });
    expect(screen.queryByRole('link', { name: /New Product/ })).not.toBeInTheDocument();
  });
});

describe('ProductForm — create', () => {
  beforeEach(() => push.mockClear());

  it('creates a product with attributes and goes to its editor', async () => {
    const { calls } = routes({
      'POST /catalog/products': () => product({ id: 'new1' }),
    });
    renderWithProviders(<ProductForm product={null} />, { session: manager });
    await userEvent.type(await screen.findByLabelText(/^Name/), '  Walnut Table ');
    await userEvent.type(screen.getByLabelText(/^Price/), '250.5');
    await userEvent.selectOptions(await screen.findByLabelText('Wood'), 'teak');
    await userEvent.type(screen.getByLabelText('Alternative names'), 'dining table, desk');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/products/new1'));
    const body = calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Walnut Table',
      basePrice: '250.50',
      type: 'STOCKABLE',
      aliases: ['dining table', 'desk'],
      customFields: { wood: 'teak' },
      categoryId: null,
    });
    expect(typeof body.basePrice).toBe('string'); // money is never a JS number
  });

  it("places the server's field-level errors on the fields, including custom fields", async () => {
    routes({
      'POST /catalog/products': () =>
        failure(400, 'VALIDATION_FAILED', {
          'customFields.wood': ['must be one of the allowed options'],
          name: ['is required'],
        }),
    });
    renderWithProviders(<ProductForm product={null} />, { session: manager });
    await userEvent.type(await screen.findByLabelText(/^Name/), 'X');
    await userEvent.type(screen.getByLabelText(/^Price/), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('must be one of the allowed options')).toBeInTheDocument();
    expect(screen.getByText('is required')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows category-scoped fields only inside that category and its sub-categories (6.5)', async () => {
    routes();
    renderWithProviders(<ProductForm product={null} />, { session: manager });
    await screen.findByLabelText('Wood');
    expect(screen.queryByLabelText(/Seats/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'c-sofas'); // a child of Living
    expect(await screen.findByLabelText(/Seats/)).toBeInTheDocument();
  });

  it('does not offer the cost price without product:view_cost', async () => {
    routes();
    renderWithProviders(<ProductForm product={null} />, {
      session: { permissions: ['product:create', 'product:view'] },
    });
    await screen.findByLabelText(/^Price/);
    expect(screen.queryByLabelText('Cost price')).not.toBeInTheDocument();
  });
});

describe('ProductForm — edit', () => {
  const editor = (p: ProductView, session = manager) =>
    renderWithProviders(<ProductForm product={p} />, { session });

  it('saves with the version it read, and shows a confirmation', async () => {
    const { calls } = routes({
      'PATCH /catalog/products/p1': () => product({ name: 'Corner Sofa XL', version: 4 }),
      'GET /fields': () => productFields.slice(0, 1),
    });
    editor(product());
    const name = await screen.findByLabelText(/^Name/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Corner Sofa XL');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({ name: 'Corner Sofa XL', version: 3, costPrice: '600' });
  });

  it('explains a stale version instead of overwriting', async () => {
    routes({
      'PATCH /catalog/products/p1': () => failure(409, 'STALE_VERSION'),
      'GET /fields': () => productFields.slice(0, 1),
    });
    editor(product());
    const name = await screen.findByLabelText(/^Name/);
    await userEvent.type(name, ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('archives after confirmation, and archived products are read-only with a restore button', async () => {
    let current = product();
    const { calls } = routes({
      'GET /catalog/products/p1': () => current,
      'POST /catalog/products/p1/archive': () => {
        current = product({ status: 'ARCHIVED', version: 4 });
        return current;
      },
      'GET /fields': () => productFields.slice(0, 1),
    });
    renderWithProviders(<ProductEditor productId="p1" />, { session: manager });
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: /Archive Corner Sofa/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/This product is archived/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/catalog/products/p1/archive')?.body).toEqual({
      version: 3,
    });
    expect(screen.getByLabelText(/^Name/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('is read-only without product:edit and hides archive without product:archive', async () => {
    routes({ 'GET /fields': () => productFields.slice(0, 1) });
    editor(product({ costPrice: undefined, variants: [variant({ costOverride: undefined })] }), {
      permissions: ['product:view'],
    });
    expect(await screen.findByLabelText(/^Name/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add variant' })).not.toBeInTheDocument();
  });
});

describe('variants', () => {
  const open = (extra: Record<string, () => unknown> = {}) => {
    const api = routes({
      'GET /fields': () => variantFields,
      ...extra,
    });
    renderWithProviders(<ProductForm product={product({ customFields: {} })} />, {
      session: manager,
    });
    return api;
  };

  it('lists variants and edits one with its price, barcode and stock limits', async () => {
    const { calls } = open({ 'PATCH /catalog/variants/v1': () => variant() });
    const table = await screen.findByRole('table', { name: 'Variants of this product' });
    expect(within(table).getAllByText('SOFA-1').length).toBeGreaterThan(0);
    expect(within(table).getByText('Product price')).toBeInTheDocument();
    await userEvent.click(within(table).getByRole('button', { name: /Edit/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit SOFA-1' });
    await userEvent.type(within(dialog).getByLabelText('Price override'), '1200.5');
    await userEvent.clear(within(dialog).getByLabelText('Barcode'));
    await userEvent.type(within(dialog).getByLabelText('Barcode'), '9999');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      sku: 'SOFA-1',
      barcode: '9999',
      priceOverride: '1200.50',
      minStockLevel: '2',
      costOverride: '600',
    });
  });

  it('shows duplicate SKU or barcode errors on the field', async () => {
    open({
      'POST /catalog/products/p1/variants': () =>
        failure(409, 'POSSIBLE_DUPLICATE', { sku: ['is already in use in this workspace'] }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Add variant' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add variant' });
    await userEvent.type(within(dialog).getByLabelText(/^SKU/), 'DUP');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('is already in use in this workspace'),
    ).toBeInTheDocument();
  });

  it('generates variants from the axis options that are ticked', async () => {
    const { calls } = open({
      'POST /catalog/products/p1/generate-variants': () => ({ created: [{}, {}], skipped: 0 }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Generate variants' }));
    const dialog = await screen.findByRole('dialog', { name: 'Generate variants' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Up to 2 combinations');
    await userEvent.click(within(dialog).getByLabelText('Blue'));
    expect(within(dialog).getByRole('status')).toHaveTextContent('Up to 1 combinations');
    await userEvent.click(within(dialog).getByLabelText('Blue'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate' }));
    expect(await screen.findByText('2 variants created, 0 already existed.')).toBeInTheDocument();
    expect(
      calls.find((c) => c.method === 'POST' && c.path.endsWith('generate-variants'))?.body,
    ).toEqual({
      axes: [{ key: 'tone', optionKeys: ['red', 'blue'] }],
    });
  });

  it('offers generation only when a variant-axis field exists', async () => {
    routes({ 'GET /fields': () => [] });
    renderWithProviders(<ProductForm product={product({ customFields: {} })} />, {
      session: manager,
    });
    await screen.findByRole('button', { name: 'Add variant' });
    expect(screen.queryByRole('button', { name: 'Generate variants' })).not.toBeInTheDocument();
  });
});

describe('images', () => {
  const withImages = (images: ProductView['images'], extra: Record<string, () => unknown> = {}) => {
    const api = routes({
      'GET /fields': () => [],
      'GET /files/f1/url': () => ({
        url: 'https://files.test/f1',
        thumbnailUrl: 'https://files.test/f1t',
        expiresAt: 'x',
      }),
      'GET /files/f2/url': () => ({
        url: 'https://files.test/f2',
        thumbnailUrl: null,
        expiresAt: 'x',
      }),
      ...extra,
    });
    renderWithProviders(<ProductForm product={product({ images })} />, { session: manager });
    return api;
  };

  it('shows images through signed URLs and marks the main one', async () => {
    withImages([
      { id: 'i1', fileId: 'f1', variantId: null, sortOrder: 0, isPrimary: true },
      { id: 'i2', fileId: 'f2', variantId: null, sortOrder: 1, isPrimary: false },
    ]);
    const first = await screen.findByAltText('Corner Sofa, image 1');
    await waitFor(() => expect(first).toHaveAttribute('src', 'https://files.test/f1t'));
    expect(screen.getByText('Main image')).toBeInTheDocument();
  });

  it('makes an image main, reorders and removes', async () => {
    const { calls } = withImages(
      [
        { id: 'i1', fileId: 'f1', variantId: null, sortOrder: 0, isPrimary: true },
        { id: 'i2', fileId: 'f2', variantId: null, sortOrder: 1, isPrimary: false },
      ],
      {
        'POST /catalog/images/i2/primary': () => ({}),
        'PUT /catalog/products/p1/images/order': () => [],
        'DELETE /catalog/images/i1': () => undefined,
      },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Make main 2' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/catalog/images/i2/primary')).toBe(true),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move later 1' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ imageIds: ['i2', 'i1'] }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove 1' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('attaches an uploaded file to the product', async () => {
    const { calls } = withImages([], {
      'POST /files': () => ({
        id: 'newfile',
        name: 'a.png',
        mime: 'image/png',
        size: 5,
        hasThumbnail: true,
      }),
      'POST /catalog/products/p1/images': () => ({}),
    });
    const input =
      (await screen.findByLabelText('Add an image', { selector: 'input' }).catch(() => null)) ??
      document.querySelector('input[type=file]');
    await userEvent.upload(
      input as HTMLInputElement,
      new File(['x'], 'a.png', { type: 'image/png' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/catalog/products/p1/images')?.body).toEqual({
        fileId: 'newfile',
      }),
    );
  });
});

describe('CategoryManager', () => {
  it('shows the tree with inactive ones marked, and creates a sub-category', async () => {
    const withInactive = [
      ...tree,
      { id: 'c-old', name: 'Old range', parentId: null, sortOrder: 1, active: false, children: [] },
    ];
    const { calls } = routes({
      'GET /catalog/categories': () => withInactive,
      'POST /catalog/categories': () => ({}),
    });
    renderWithProviders(<CategoryManager />, { session: manager });
    expect((await screen.findAllByText('Sofas')).length).toBeGreaterThan(0);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(calls[0]?.query.get('includeInactive')).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: 'Add category' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add category' });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Corner sofas');
    await userEvent.selectOptions(within(dialog).getByLabelText('Inside'), 'c-sofas');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Corner sofas',
      parentId: 'c-sofas',
      sortOrder: 0,
    });
  });

  it('does not offer a category itself or its sub-categories as its parent', async () => {
    routes({ 'PATCH /catalog/categories/c-living': () => ({}) });
    renderWithProviders(<CategoryManager />, { session: manager });
    await userEvent.click(await screen.findByRole('button', { name: /Edit\s+Living/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Living' });
    const options = within(within(dialog).getByLabelText('Inside')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Top level']);
  });

  it('is view-only without product:edit', async () => {
    routes();
    renderWithProviders(<CategoryManager />, { session: { permissions: ['product:view'] } });
    await screen.findByText('Living');
    expect(screen.queryByRole('button', { name: 'Add category' })).not.toBeInTheDocument();
  });
});

describe('BrandManager', () => {
  it('adds and deactivates brands', async () => {
    const { calls } = routes({
      'GET /catalog/brands': () => [{ id: 'b1', name: 'Acme', active: true }],
      'POST /catalog/brands': () => ({}),
      'PATCH /catalog/brands/b1': () => ({}),
    });
    renderWithProviders(<BrandManager />, { session: manager });
    await screen.findAllByText('Acme');
    await userEvent.click(screen.getByRole('button', { name: 'Add brand' }));
    let dialog = await screen.findByRole('dialog', { name: 'Add brand' });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Zenith');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Zenith' }),
    );

    await userEvent.click(screen.getByRole('button', { name: /Edit\s+Acme/ }));
    dialog = await screen.findByRole('dialog', { name: 'Edit Acme' });
    await userEvent.click(within(dialog).getByLabelText('Active'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        name: 'Acme',
        active: false,
      }),
    );
  });

  it("shows the API's duplicate-name message on the field", async () => {
    routes({
      'GET /catalog/brands': () => [],
      'POST /catalog/brands': () =>
        failure(409, 'POSSIBLE_DUPLICATE', { name: ['already exists'] }),
    });
    renderWithProviders(<BrandManager />, { session: manager });
    await userEvent.click(await screen.findByRole('button', { name: 'Add brand' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add brand' });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Acme');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('already exists')).toBeInTheDocument();
  });
});
