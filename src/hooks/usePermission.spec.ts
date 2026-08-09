import { describe, expect, it } from 'vitest';
import { usePermission } from './usePermission';
import type { User } from '../store';

/**
 * The app's only role predicate. Despite the `use` prefix it calls no hooks and
 * needs no render — worth knowing, because it means the one place that should
 * be using it and is not (`Dashboard`) could adopt it with a one-line change.
 */

const withRole = (role: string): User => ({
    id: 1,
    firstName: 'A',
    lastName: 'B',
    email: 'a@b.test',
    role,
});

describe('usePermission', () => {
    const { isAllowed } = usePermission();

    it('should allow an admin', () => {
        expect(isAllowed(withRole('admin'))).toBe(true);
    });

    it('should allow a manager', () => {
        expect(isAllowed(withRole('manager'))).toBe(true);
    });

    it('should reject a customer', () => {
        // The storefront role. `login.tsx` uses this to sign them straight back
        // out — the commented-out line beside it shows the intent was to bounce
        // them to client-ui instead.
        expect(isAllowed(withRole('customer'))).toBe(false);
    });

    it('should reject an unknown role', () => {
        expect(isAllowed(withRole('superadmin'))).toBe(false);
    });

    it('should reject null', () => {
        // What `refetch()` yields when the `self` call failed. Returning false
        // rather than throwing is what stops a failed login committing an
        // undefined user to the store.
        expect(isAllowed(null)).toBe(false);
    });

    it('should reject undefined', () => {
        expect(isAllowed(undefined as unknown as User)).toBe(false);
    });

    it('should be case sensitive', () => {
        // auth-service stores lowercase roles, so this is only a hazard if
        // something ever normalises them differently.
        expect(isAllowed(withRole('Admin'))).toBe(false);
    });

    it('should return a stable predicate without rendering', () => {
        expect(typeof usePermission().isAllowed).toBe('function');
    });
});
