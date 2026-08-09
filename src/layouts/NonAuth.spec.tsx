import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import NonAuth from './NonAuth';
import { ADMIN, MANAGER, renderWithProviders } from '../test-utils';

/**
 * The other half of the gate pair. `Dashboard` sends a logged-out visitor to
 * `/auth/login?returnTo=<where they were>`; this reads that key back and sends
 * them on once a user appears. Between them they are the entire deep-link
 * mechanism — there is no other code involved.
 */

import type { User } from '../store';

const routes = (
    <Routes>
        <Route path="/auth" element={<NonAuth />}>
            <Route path="login" element={<div>login form</div>} />
        </Route>
        <Route path="/" element={<div>dashboard home</div>} />
        <Route path="/orders" element={<div>orders page</div>} />
        <Route path="*" element={<div>no match</div>} />
    </Routes>
);

const renderNonAuth = (route: string, user: User | null = null) =>
    renderWithProviders(routes, { route, user });

describe('NonAuth', () => {
    describe('when nobody is logged in', () => {
        it('should render the login form', () => {
            renderNonAuth('/auth/login', null);

            expect(screen.getByText('login form')).toBeInTheDocument();
        });

        it('should not redirect', () => {
            renderNonAuth('/auth/login', null);

            expect(screen.queryByText('dashboard home')).not.toBeInTheDocument();
        });
    });

    describe('when someone is already logged in', () => {
        it('should send them to the dashboard by default', () => {
            renderNonAuth('/auth/login', ADMIN);

            expect(screen.getByText('dashboard home')).toBeInTheDocument();
            expect(screen.queryByText('login form')).not.toBeInTheDocument();
        });

        it('should honour returnTo', () => {
            // The round trip: Dashboard wrote this key, NonAuth reads it. An
            // admin who deep-linked to /orders and had to sign in lands back on
            // /orders rather than the home page.
            renderNonAuth('/auth/login?returnTo=/orders', MANAGER);

            expect(screen.getByText('orders page')).toBeInTheDocument();
        });

        it('should fall back to the dashboard for an empty returnTo', () => {
            renderNonAuth('/auth/login?returnTo=', ADMIN);

            expect(screen.getByText('dashboard home')).toBeInTheDocument();
        });

        it('should follow an absolute path in returnTo without validating it', () => {
            // BUG-adjacent, captured rather than asserted as correct. The value
            // is taken straight from the query string and handed to `Navigate`.
            // A crafted `/auth/login?returnTo=...` cannot leave the app —
            // react-router treats it as an in-app path — so this is not an open
            // redirect, but nothing constrains it to a route that exists
            // either, and an unknown path renders the router's no-match state.
            renderNonAuth('/auth/login?returnTo=/nowhere-real', ADMIN);

            expect(screen.getByText('no match')).toBeInTheDocument();
        });
    });

    it('should not check the role', () => {
        // Worth pinning: `NonAuth` only asks whether a user exists. A customer
        // who somehow reached the store — see Dashboard.spec.tsx — is bounced
        // *into* the dashboard from here rather than being stopped.
        renderNonAuth('/auth/login', {
            id: 9,
            firstName: 'C',
            lastName: 'D',
            email: 'c@d.test',
            role: 'customer',
        });

        expect(screen.getByText('dashboard home')).toBeInTheDocument();
    });
});
