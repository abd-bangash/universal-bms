import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, mockFetch, renderWithProviders } from '@/test/render';
import { FileUpload } from './file-upload';

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const png = (name = 'a.png') => new File(['x'], name, { type: 'image/png' });

describe('FileUpload', () => {
  it('posts the file with its link fields and reports the stored file', async () => {
    const stored = { id: 'f1', name: 'a.png', mime: 'image/png', size: 1, hasThumbnail: true };
    const fetchMock = mockFetch(() => jsonResponse({ data: stored }, 201));
    const onUploaded = jest.fn();
    renderWithProviders(
      <FileUpload entityType="PRODUCT" entityId="p1" purpose="image" onUploaded={onUploaded} />,
      { session: null },
    );
    await userEvent.upload(fileInput(), png());
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(stored));
    expect(await screen.findByText('Uploaded: a.png')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/bff/files');
    const form = init.body as FormData;
    expect(form.get('entityType')).toBe('PRODUCT');
    expect(form.get('entityId')).toBe('p1');
    expect(form.get('purpose')).toBe('image');
    expect((form.get('file') as File).name).toBe('a.png');
  });

  it('refuses an over-sized file without calling the server', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: {} }));
    renderWithProviders(<FileUpload maxMb={1} onUploaded={jest.fn()} />, { session: null });
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await userEvent.upload(fileInput(), big);
    expect(await screen.findByRole('alert')).toHaveTextContent('larger than 1 MB');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when the upload is rejected', async () => {
    mockFetch(() =>
      jsonResponse({ statusCode: 413, code: 'FILE_TOO_LARGE', message: 'x', requestId: 'r' }, 413),
    );
    const onUploaded = jest.fn();
    renderWithProviders(<FileUpload onUploaded={onUploaded} />, { session: null });
    await userEvent.upload(fileInput(), png());
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is too large.');
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('offers only the allowed types', () => {
    renderWithProviders(<FileUpload onUploaded={jest.fn()} />, { session: null });
    expect(fileInput()).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp,application/pdf',
    );
  });
});
