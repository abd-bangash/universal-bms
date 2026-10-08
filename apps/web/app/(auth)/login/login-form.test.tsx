import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, mockFetch, renderWithProviders } from '@/test/render';
import { LoginForm } from './login-form';

const replace = jest.fn();
let search = '';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
  replace.mockReset();
  search = '';
});

async function signIn(email = 'ada@example.test', password = 'correct horse') {
  await userEvent.type(screen.getByLabelText('Email address'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginForm', () => {
  it('signs in through the BFF and goes to the home page', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({ data: { requiresWorkspaceSelection: false } }),
    );
    renderWithProviders(<LoginForm />, { session: null });
    await signIn();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/bff/auth/login');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'ada@example.test',
      password: 'correct horse',
    });
  });

  it('returns the user to the page they were on after signing in (Requirement 49.10)', async () => {
    search = 'returnTo=%2Forders%2F12%3Ftab%3Dpay';
    mockFetch(() => jsonResponse({ data: { requiresWorkspaceSelection: false } }));
    renderWithProviders(<LoginForm />, { session: null });
    await signIn();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/orders/12?tab=pay'));
  });

  it('ignores a return address that points to another site', async () => {
    search = 'returnTo=https%3A%2F%2Fevil.example%2F';
    mockFetch(() => jsonResponse({ data: { requiresWorkspaceSelection: false } }));
    renderWithProviders(<LoginForm />, { session: null });
    await signIn();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('goes on to workspace selection when the account belongs to several workspaces', async () => {
    search = 'returnTo=%2Fcustomers';
    mockFetch(() =>
      jsonResponse({
        data: {
          requiresWorkspaceSelection: true,
          workspaces: [
            { id: 'w1', name: 'A' },
            { id: 'w2', name: 'B' },
          ],
        },
      }),
    );
    renderWithProviders(<LoginForm />, { session: null });
    await signIn();
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/select-workspace?returnTo=%2Fcustomers'),
    );
  });

  it('validates before calling the server', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: {} }));
    renderWithProviders(<LoginForm />, { session: null });
    await userEvent.type(screen.getByLabelText('Email address'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
  });

  it.each([
    ['INVALID_CREDENTIALS', 401, 'The email or password is incorrect.'],
    ['ACCOUNT_LOCKED', 401, 'Too many failed attempts. Try again in 15 minutes.'],
    ['RATE_LIMITED', 429, 'Too many requests. Please wait a moment and try again.'],
  ])('explains %s in plain words and stays on the page', async (code, status, text) => {
    mockFetch(() =>
      jsonResponse(
        { statusCode: status, code, message: 'raw server text', requestId: 'r' },
        status,
      ),
    );
    renderWithProviders(<LoginForm />, { session: null });
    await signIn();
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('tells the user when the server cannot be reached', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    renderWithProviders(<LoginForm />, { session: null });
    await signIn();
    expect(await screen.findByText(/server could not be reached/i)).toBeInTheDocument();
  });

  it('prevents a second submission while signing in', async () => {
    let finish: () => void = () => undefined;
    const fetchMock = mockFetch(() => new Response(null));
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>(
          (resolve) =>
            (finish = () => resolve(jsonResponse({ data: { requiresWorkspaceSelection: false } }))),
        ),
    );
    renderWithProviders(<LoginForm />, { session: null });
    await signIn();
    const button = await screen.findByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    finish();
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });
});
