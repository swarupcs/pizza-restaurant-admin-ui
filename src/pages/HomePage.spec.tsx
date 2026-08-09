import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import HomePage from './HomePage';
import { ADMIN, MANAGER, renderWithProviders } from '../test-utils';

/**
 * The landing page — the first screen every user sees after signing in.
 *
 * There is nothing to test about its data flow because it has none. Everything
 * below the greeting is a literal, and that is the point of this file: the
 * numbers look like a working dashboard and are not.
 */

describe('HomePage', () => {
    it('should greet the signed-in user by name', () => {
        // The only real data on the page.
        renderWithProviders(<HomePage />, { user: ADMIN });

        expect(screen.getByText(/Welcome, Swarup/)).toBeInTheDocument();
    });

    it('should greet a manager too', () => {
        renderWithProviders(<HomePage />, { user: MANAGER });

        expect(screen.getByText(/Welcome, Meera/)).toBeInTheDocument();
    });

    it('should render an empty greeting when nobody is signed in', () => {
        // Reachable only if the Dashboard gate is bypassed, but `user?.firstName`
        // renders as nothing rather than throwing.
        renderWithProviders(<HomePage />, { user: null });

        expect(screen.getByText(/Welcome,/)).toBeInTheDocument();
    });

    describe('the statistics', () => {
        it('should show a hardcoded order count', () => {
            // BUG, captured rather than asserted as correct. `52` is a literal
            // in the JSX. It does not change, it has never been fetched, and
            // there is no endpoint behind it.
            renderWithProviders(<HomePage />, { user: ADMIN });

            expect(screen.getByText('52')).toBeInTheDocument();
        });

        it('should show a hardcoded sales total', () => {
            // Likewise `70000`, rendered as ₹70,000.00 with two decimal places
            // of invented precision.
            renderWithProviders(<HomePage />, { user: ADMIN });

            expect(screen.getByText(/70,000/)).toBeInTheDocument();
        });

        it('should show the same numbers to every user', () => {
            // A manager at one restaurant sees exactly what an admin across all
            // of them sees, because neither is reading anything.
            const { unmount } = renderWithProviders(<HomePage />, { user: ADMIN });
            expect(screen.getByText('52')).toBeInTheDocument();
            unmount();

            renderWithProviders(<HomePage />, { user: MANAGER });
            expect(screen.getByText('52')).toBeInTheDocument();
        });

        it('should render an empty Sales card', () => {
            // `<Card title="Sales" ... ></Card>` — the chart that belongs here
            // was never built.
            renderWithProviders(<HomePage />, { user: ADMIN });

            // antd omits the body element entirely when a Card has no
            // children, which is the clearest possible signal that nothing was
            // ever put here.
            const card = screen.getByText('Sales').closest('.ant-card') as HTMLElement;
            expect(card).not.toBeNull();
            expect(card.querySelector('.ant-card-body')).toBeNull();
        });
    });

    describe('the recent orders list', () => {
        it('should show six invented orders', () => {
            // BUG, captured rather than asserted as correct. The `list` const at
            // the top of the file is six hardcoded objects with addresses in
            // Mumbai and West Bengal and statuses ("preparing", "on the way")
            // that are not even in the platform's OrderStatus enum.
            renderWithProviders(<HomePage />, { user: ADMIN });

            expect(screen.getAllByText('Paneer, Chicken BBQ ...')).toHaveLength(5);
            expect(screen.getByText('Peperoni, Margarita ...')).toBeInTheDocument();
        });

        it('should use statuses that do not exist in the platform', () => {
            renderWithProviders(<HomePage />, { user: ADMIN });

            expect(screen.getByText('preparing')).toBeInTheDocument();
            expect(screen.getAllByText('on the way').length).toBeGreaterThan(0);
        });

        it('should link every order to ant.design', () => {
            // The placeholder href from the antd docs example this was copied
            // from, shipped as-is.
            renderWithProviders(<HomePage />, { user: ADMIN });

            expect(screen.getByText('Peperoni, Margarita ...')).toHaveAttribute(
                'href',
                'https://ant.design',
            );
        });

        it('should link "See all orders" to the real orders page', () => {
            // The one working link on the card.
            renderWithProviders(<HomePage />, { user: ADMIN });

            expect(screen.getByText('See all orders')).toHaveAttribute('href', '/orders');
        });
    });
});
