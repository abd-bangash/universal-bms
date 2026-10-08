import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { ConfirmDialog } from './confirm-dialog';

const baseProps = {
  title: 'Delete the role?',
  description: 'This cannot be undone.',
  confirmLabel: 'Delete',
};

describe('ConfirmDialog', () => {
  it('opens as a modal dialog with its title and description', () => {
    renderWithProviders(
      <ConfirmDialog open {...baseProps} onConfirm={jest.fn()} onCancel={jest.fn()} />,
      { session: null },
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete the role?' });
    expect(dialog).toBeVisible();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('stays closed until opened', () => {
    renderWithProviders(
      <ConfirmDialog open={false} {...baseProps} onConfirm={jest.fn()} onCancel={jest.fn()} />,
      { session: null },
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirms and cancels with the buttons', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    renderWithProviders(
      <ConfirmDialog open {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />,
      { session: null },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('treats Escape as cancel, unless an action is pending', () => {
    const onCancel = jest.fn();
    const { rerender } = renderWithProviders(
      <ConfirmDialog open {...baseProps} onConfirm={jest.fn()} onCancel={onCancel} />,
      { session: null },
    );
    const dialog = screen.getByRole('dialog');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(
      <ConfirmDialog open pending {...baseProps} onConfirm={jest.fn()} onCancel={onCancel} />,
    );
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while the confirmed action runs', () => {
    renderWithProviders(
      <ConfirmDialog open pending {...baseProps} onConfirm={jest.fn()} onCancel={jest.fn()} />,
      { session: null },
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
