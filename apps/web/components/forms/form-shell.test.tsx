import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { ApiError } from '@/lib/errors';
import { renderWithProviders } from '@/test/render';
import { FormShell, applyServerErrors } from './form-shell';

interface Values {
  name: string;
  email: string;
}

function Demo({ onSubmit }: { onSubmit: (values: Values) => Promise<void> }) {
  const form = useForm<Values>({ defaultValues: { name: '', email: '' } });
  const { errors } = form.formState;
  return (
    <FormShell form={form} onSubmit={onSubmit} submitLabel="Save customer" successMessage="Saved!">
      <label htmlFor="name">Name</label>
      <input id="name" {...form.register('name')} />
      {errors.name ? <p role="alert">{errors.name.message}</p> : null}
      <label htmlFor="email">Email</label>
      <input id="email" {...form.register('email')} />
      {errors.email ? <p role="alert">{errors.email.message}</p> : null}
    </FormShell>
  );
}

const validation = (details: Record<string, string[]>) =>
  new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', details);

describe('FormShell', () => {
  it('submits the values', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    renderWithProviders(<Demo onSubmit={onSubmit} />, { session: null });
    await userEvent.type(screen.getByLabelText('Name'), 'Ann');
    await userEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'Ann', email: '' }));
    expect(await screen.findByText('Saved!')).toBeInTheDocument();
  });

  it('shows the server’s field errors against their fields, and a summary banner (Requirement 49.5)', async () => {
    const onSubmit = jest
      .fn()
      .mockRejectedValue(
        validation({ email: ['is already used'], name: ['is required', 'second message'] }),
      );
    renderWithProviders(<Demo onSubmit={onSubmit} />, { session: null });
    await userEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(await screen.findByText('is already used')).toBeInTheDocument();
    expect(screen.getByText('is required')).toBeInTheDocument();
    expect(screen.queryByText('second message')).not.toBeInTheDocument();
    expect(screen.getByText('Please check the highlighted fields.')).toBeInTheDocument();
  });

  it('shows a general banner for errors that belong to no field', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new ApiError(403, 'PERMISSION_DENIED', 'no'));
    renderWithProviders(<Demo onSubmit={onSubmit} />, { session: null });
    await userEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
  });

  it('shows a safe message for unexpected errors', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('boom: secret details'));
    renderWithProviders(<Demo onSubmit={onSubmit} />, { session: null });
    await userEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/secret details/)).not.toBeInTheDocument();
  });

  it('disables the submit button while the request is pending, so it cannot be sent twice', async () => {
    let finish: () => void = () => undefined;
    const onSubmit = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderWithProviders(<Demo onSubmit={onSubmit} />, { session: null });
    await userEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    const button = await screen.findByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(await screen.findByRole('button', { name: 'Save customer' })).toBeEnabled();
  });

  it('warns before the page is left while there are unsaved changes, and not otherwise', async () => {
    renderWithProviders(<Demo onSubmit={jest.fn()} />, { session: null });
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await userEvent.type(screen.getByLabelText('Name'), 'x');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('stops warning once the form has been saved', async () => {
    renderWithProviders(<Demo onSubmit={jest.fn().mockResolvedValue(undefined)} />, {
      session: null,
    });
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    await screen.findByText('Saved!');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('applyServerErrors', () => {
  it('returns whether any message was placed on a field', () => {
    const setError = jest.fn();
    const form = { setError } as unknown as Parameters<typeof applyServerErrors<Values>>[0];
    expect(applyServerErrors(form, validation({ email: ['bad'] }))).toBe(true);
    expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'bad' });
    expect(applyServerErrors(form, new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(false);
    expect(applyServerErrors(form, validation({ name: [] }))).toBe(false);
  });
});
