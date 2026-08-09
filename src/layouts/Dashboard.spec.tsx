import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock('../http/api', () => apiMock);

import Dashboard from './Dashboard';
import { useAuthStore, type User } from '../store';
import { ADMIN, CUSTOMER, MANAGER, axiosResponse, renderWithProviders } from '../test-utils';

/**
 * The shell every authenticated page renders inside — and the only gate
 * standing between a session and the back office.
 */

const renderDashboard = (user: User | null, route = '/') =>
    renderWithProviders(
        <Routes>
            <Route path="/" element={<Dashboard />}>
                <Route index element={<div>page content</div>} />
            </Route>
            <Route path="/orders" element={<Dashboard />}>
                <Route index element={<div>page content</div>} />
            </Route>
            <Route path="/auth/login" element={<LoginProbe />} />
        </Routes>,
        { user, route },
    );

/** Stands in for the login page and reports the query string it was reached with. */
const LoginProbe = () => {
    const { search } = useLocation();
    return <div data-testid="login">{search}</div>;
};

const menuLabels = () =>
    within(document.querySelector('.ant-menu') as HTMLElement)
        .getAllByRole('menuitem')
        .map((item) => item.textContent);

describe('Dashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMock.logout.mockResolvedValue(axiosResponse({}));
    });

    describe('the gate', () => {
        it('should send a logged-out visitor to the login page', () => {
            renderDashboard(null);

            expect(screen.getByTestId('login')).toBeInTheDocument();
        });

        it('should remember where they were trying to go', () => {
            // The `returnTo` half of the round trip NonAuth completes.
            renderDashboard(null, '/orders');

            expect(screen.getByTestId('login')).toHaveTextContent('?returnTo=/orders');
        });

        it('should record the root path when that is where they were', () => {
            renderDashboard(null, '/');

            expect(screen.getByTestId('login')).toHaveTextContent('?returnTo=/');
        });

        it('should render the shell for an admin', () => {
            renderDashboard(ADMIN);

            expect(screen.getByText('page content')).toBeInTheDocument();
        });

        it('should render the shell for a manager', () => {
            renderDashboard(MANAGER);

            expect(screen.getByText('page content')).toBeInTheDocument();
        });

        it('should let a customer straight in', () => {
            // BUG, captured rather than asserted as correct, and the one to fix
            // first in this app.
            //
            // The role check lives in `login.tsx`'s `onSuccess` and nowhere
            // else. `Root` calls /auth/self and commits whatever it gets to the
            // store; this component then asks only `if (user === null)`.
            //
            // So a customer who signed in on client-ui — same cookie domain,
            // same auth-service — and then navigates to admin-ui is handed the
            // dashboard shell, the sidebar, and the Products and Orders pages.
            // The API calls behind them mostly 403, so this is UI exposure
            // rather than a data breach, but the guard already exists:
            // `usePermission().isAllowed(user)` is one line away and is already
            // imported in login.tsx.
            renderDashboard(CUSTOMER);

            expect(screen.getByText('page content')).toBeInTheDocument();
            expect(screen.queryByTestId('login')).not.toBeInTheDocument();
        });
    });

    describe('the sidebar', () => {
        it('should show the shared items to a manager', () => {
            renderDashboard(MANAGER);

            expect(menuLabels()).toEqual(['Home', 'Products', 'Orders', 'Promos']);
        });

        it('should add Users and Restaurants for an admin', () => {
            renderDashboard(ADMIN);

            expect(menuLabels()).toEqual([
                'Home',
                'Users',
                'Restaurants',
                'Products',
                'Orders',
                'Promos',
            ]);
        });

        it('should hide Users from a manager', () => {
            // Only a presentational hide — `Users.tsx` carries its own
            // `Navigate` guard, which is the check that actually holds.
            renderDashboard(MANAGER);

            expect(menuLabels()).not.toContain('Users');
        });

        it('should show the customer the manager menu', () => {
            // Falls through the `role === 'admin'` branch to the base items, so
            // an unexpected role silently gets the smaller menu rather than
            // nothing.
            renderDashboard(CUSTOMER);

            expect(menuLabels()).toEqual(['Home', 'Products', 'Orders', 'Promos']);
        });

        it('should link to a Promos route that does not exist', () => {
            // BUG, captured rather than asserted as correct. `router.tsx` has no
            // `/promos` entry, so clicking it leaves react-router with no match
            // and the content area empty.
            renderDashboard(ADMIN);

            const promos = screen.getByRole('link', { name: 'Promos' });
            expect(promos).toHaveAttribute('href', '/promos');
        });
    });

    describe('the header', () => {
        it('should tell an admin they are an admin', () => {
            renderDashboard(ADMIN);

            expect(screen.getByText('You are an admin')).toBeInTheDocument();
        });

        it('should show a manager their restaurant', () => {
            renderDashboard(MANAGER);

            expect(screen.getByText('Pizza Palace')).toBeInTheDocument();
        });

        it('should show a hardcoded avatar letter', () => {
            // Literally `U`, not the user's initial.
            renderDashboard(ADMIN);

            expect(screen.getByText('U')).toBeInTheDocument();
        });
    });

    describe('logging out', () => {
        const openMenu = async () => {
            const user = userEvent.setup();
            await user.click(screen.getByText('U'));
            return user;
        };

        it('should call the logout endpoint', async () => {
            renderDashboard(ADMIN);
            const user = await openMenu();

            await user.click(await screen.findByText('Logout'));

            await waitFor(() => expect(apiMock.logout).toHaveBeenCalledTimes(1));
        });

        it('should clear the store', async () => {
            renderDashboard(ADMIN);
            const user = await openMenu();

            await user.click(await screen.findByText('Logout'));

            await waitFor(() => expect(useAuthStore.getState().user).toBeNull());
        });

        it('should leave the user signed in when the server rejects the logout', async () => {
            // BUG, captured rather than asserted as correct. The store is only
            // cleared in `onSuccess`, and there is no `onError`. auth-service
            // returns 401 when the access token has already expired — the
            // likely case for someone who left the tab open — so clicking
            // Logout does nothing at all, with no message.
            //
            // Clearing locally regardless, and treating the revoke as
            // best-effort, is the usual fix.
            apiMock.logout.mockRejectedValue(new Error('401'));
            renderDashboard(ADMIN);
            const user = await openMenu();

            await user.click(await screen.findByText('Logout'));

            await waitFor(() => expect(apiMock.logout).toHaveBeenCalled());
            expect(useAuthStore.getState().user).toEqual(ADMIN);
        });
    });
});
