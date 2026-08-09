import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMock = vi.hoisted(() => ({ login: vi.fn(), self: vi.fn(), logout: vi.fn() }));
vi.mock('../../http/api', () => apiMock);

import LoginPage from './login';
import { useAuthStore } from '../../store';
import { ADMIN, CUSTOMER, MANAGER, axiosResponse, renderWithProviders } from '../../test-utils';

/**
 * The only place a role is checked on the way in — and, as Dashboard.spec.tsx
 * shows, the only place it is checked at all.
 *
 * The flow is deliberately two-step: log in, then re-run the `self` query and
 * commit the result only if the role passes. The mutation never puts the login
 * response in the store directly.
 */

const renderLoginPage = () => renderWithProviders(<LoginPage />);

const signIn = async (email = 'admin@test.com', password = 'secret123') => {
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Username'), email);
    await user.type(screen.getByPlaceholderText('Password'), password);
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    return user;
};

describe('Login page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMock.login.mockResolvedValue(axiosResponse({}));
        apiMock.self.mockResolvedValue(axiosResponse(ADMIN));
        apiMock.logout.mockResolvedValue(axiosResponse({}));
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    describe('rendering', () => {
        it('should render with required fields', () => {
            renderLoginPage();
            // getBy -> throws an error
            // queryBy -> null
            // findBy -> Async
            expect(screen.getByText('Sign in')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
            expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeInTheDocument();
            expect(screen.getByText('Forgot password')).toBeInTheDocument();
        });

        it('should tick Remember me by default', () => {
            renderLoginPage();

            expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeChecked();
        });

        it('should do nothing with Remember me', () => {
            // BUG-adjacent, captured rather than asserted as correct. The
            // checkbox is in the form's `initialValues` and is read by nothing:
            // `onFinish` forwards only `username` and `password`. Session length
            // is entirely auth-service's refresh-token expiry.
            renderLoginPage();

            expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeInTheDocument();
        });

        it('should link Forgot password nowhere', () => {
            renderLoginPage();

            expect(screen.getByText('Forgot password')).toHaveAttribute('href', '');
        });
    });

    describe('validation', () => {
        it('should require an email', async () => {
            renderLoginPage();
            const user = userEvent.setup();

            await user.click(screen.getByRole('button', { name: 'Log in' }));

            expect(await screen.findByText('Please input your Username')).toBeInTheDocument();
            expect(apiMock.login).not.toHaveBeenCalled();
        });

        it('should require a password', async () => {
            renderLoginPage();
            const user = userEvent.setup();

            await user.type(screen.getByPlaceholderText('Username'), 'admin@test.com');
            await user.click(screen.getByRole('button', { name: 'Log in' }));

            expect(await screen.findByText('Please input your password')).toBeInTheDocument();
        });

        it('should reject a malformed email', async () => {
            renderLoginPage();
            const user = userEvent.setup();

            await user.type(screen.getByPlaceholderText('Username'), 'not-an-email');
            await user.type(screen.getByPlaceholderText('Password'), 'secret123');
            await user.click(screen.getByRole('button', { name: 'Log in' }));

            expect(await screen.findByText('Email is not valid')).toBeInTheDocument();
            expect(apiMock.login).not.toHaveBeenCalled();
        });
    });

    describe('signing in', () => {
        it('should post the credentials', async () => {
            renderLoginPage();
            await signIn();

            await waitFor(() =>
                expect(apiMock.login).toHaveBeenCalledWith({
                    email: 'admin@test.com',
                    password: 'secret123',
                }),
            );
        });

        it('should map the username field onto email', async () => {
            // The input is named `username`; auth-service wants `email`. The
            // rename happens in `onFinish`.
            renderLoginPage();
            await signIn('someone@test.com');

            await waitFor(() =>
                expect(apiMock.login.mock.calls[0][0]).toHaveProperty('email', 'someone@test.com'),
            );
        });

        it('should re-read the session rather than trust the login response', async () => {
            // `useQuery({ enabled: false })` exists purely to be refetched here.
            // auth-service's login response does not carry the role, so the
            // gate below needs a second call.
            renderLoginPage();
            await signIn();

            await waitFor(() => expect(apiMock.self).toHaveBeenCalledTimes(1));
        });

        it('should commit an admin to the store', async () => {
            renderLoginPage();
            await signIn();

            await waitFor(() => expect(useAuthStore.getState().user).toEqual(ADMIN));
        });

        it('should commit a manager to the store', async () => {
            apiMock.self.mockResolvedValue(axiosResponse(MANAGER));
            renderLoginPage();
            await signIn();

            await waitFor(() => expect(useAuthStore.getState().user).toEqual(MANAGER));
        });

        it('should show a spinner while in flight', async () => {
            let resolve!: (value: unknown) => void;
            apiMock.login.mockReturnValue(new Promise((r) => (resolve = r)));

            renderLoginPage();
            await signIn();

            await waitFor(() =>
                expect(screen.getByRole('button', { name: /Log in/ })).toHaveClass(
                    'ant-btn-loading',
                ),
            );
            resolve(axiosResponse({}));
        });
    });

    describe('when the credentials are wrong', () => {
        beforeEach(() => {
            apiMock.login.mockRejectedValue(new Error('Email or password does not match.'));
        });

        it('should show the error', async () => {
            renderLoginPage();
            await signIn();

            expect(
                await screen.findByText('Email or password does not match.'),
            ).toBeInTheDocument();
        });

        it('should not look up the session', async () => {
            renderLoginPage();
            await signIn();

            await screen.findByText('Email or password does not match.');
            expect(apiMock.self).not.toHaveBeenCalled();
        });

        it('should leave the store empty', async () => {
            renderLoginPage();
            await signIn();

            await screen.findByText('Email or password does not match.');
            expect(useAuthStore.getState().user).toBeNull();
        });
    });

    describe('when a customer signs in', () => {
        beforeEach(() => {
            apiMock.self.mockResolvedValue(axiosResponse(CUSTOMER));
        });

        it('should sign them straight back out', async () => {
            renderLoginPage();
            await signIn('customer@test.com');

            await waitFor(() => expect(apiMock.logout).toHaveBeenCalledTimes(1));
        });

        it('should never commit them to the store', async () => {
            renderLoginPage();
            await signIn('customer@test.com');

            await waitFor(() => expect(apiMock.logout).toHaveBeenCalled());
            expect(useAuthStore.getState().user).toBeNull();
        });

        it('should leave them on the login form with no explanation', async () => {
            // BUG, captured rather than asserted as correct. The commented-out
            // line right above this branch shows the intent:
            //
            //   // logout or redirect to client ui
            //   // window.location.href = "http://clientui/url"
            //
            // As written the customer's credentials were correct, the button
            // stops spinning, nothing changes, and no message appears. They are
            // given no way to understand what happened or where to go.
            renderLoginPage();
            await signIn('customer@test.com');

            await waitFor(() => expect(apiMock.logout).toHaveBeenCalled());
            expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });

    describe('when the session lookup fails after a good login', () => {
        it('should sign the user out rather than let them through', async () => {
            // `refetch()` resolves with `data: undefined` on failure, and
            // `isAllowed(undefined)` is false — so the failure closes the gate
            // rather than opening it. Correct, and worth pinning: the opposite
            // default would be a hole.
            apiMock.self.mockRejectedValue(new Error('500'));

            renderLoginPage();
            await signIn();

            await waitFor(() => expect(apiMock.logout).toHaveBeenCalledTimes(1));
            expect(useAuthStore.getState().user).toBeNull();
        });
    });
});
