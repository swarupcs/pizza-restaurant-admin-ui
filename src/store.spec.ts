import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore, type User } from './store';

/**
 * The whole of the app's global client state: one user, set on login and
 * cleared on logout. Everything else — filters, drawers, pagination — is local
 * component state, and every piece of server data lives in TanStack Query.
 */

const ADMIN: User = {
    id: 1,
    firstName: 'Swarup',
    lastName: 'Das',
    email: 'admin@test.com',
    role: 'admin',
};

describe('useAuthStore', () => {
    beforeEach(() => {
        useAuthStore.setState({ user: null });
    });

    it('should start logged out', () => {
        expect(useAuthStore.getState().user).toBeNull();
    });

    it('should hold the user setUser is given', () => {
        useAuthStore.getState().setUser(ADMIN);

        expect(useAuthStore.getState().user).toEqual(ADMIN);
    });

    it('should clear the user on logout', () => {
        useAuthStore.getState().setUser(ADMIN);

        useAuthStore.getState().logout();

        expect(useAuthStore.getState().user).toBeNull();
    });

    it('should be readable without a React hook', () => {
        // `getState()` is what lets the axios interceptor log the user out from
        // a plain module, outside any component.
        useAuthStore.getState().setUser(ADMIN);

        expect(useAuthStore.getState().user?.role).toBe('admin');
    });

    it('should keep a manager’s tenant', () => {
        // Load-bearing: it is what scopes the products list and what the socket
        // `join` uses as its room name.
        useAuthStore.getState().setUser({
            ...ADMIN,
            role: 'manager',
            tenant: { id: 3, name: 'Pizza Palace', address: '12 Park Street' },
        });

        expect(useAuthStore.getState().user?.tenant?.id).toBe(3);
    });

    it('should replace rather than merge on a second setUser', () => {
        useAuthStore.getState().setUser({
            ...ADMIN,
            role: 'manager',
            tenant: { id: 3, name: 'Pizza Palace', address: '12 Park Street' },
        });

        useAuthStore.getState().setUser(ADMIN);

        expect(useAuthStore.getState().user?.tenant).toBeUndefined();
    });

    it('should not persist anything', () => {
        // No `persist` middleware — deliberate, and the reason `Root` re-runs
        // `/auth/self` on every page load rather than trusting a cached user.
        // The httpOnly cookie is the only thing that survives a refresh.
        useAuthStore.getState().setUser(ADMIN);

        expect(window.localStorage.getItem('auth')).toBeNull();
        expect(window.sessionStorage.length).toBe(0);
    });
});
