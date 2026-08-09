import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));
vi.mock('./client', () => client);

import * as api from './api';

/**
 * A flat list of one function per endpoint. No classes, no generated client.
 * What is worth pinning is the routing: every call goes through the gateway
 * under one of three prefixes, and this app never addresses a service directly.
 */

const url = (method: 'get' | 'post' | 'patch' | 'put') =>
    client.api[method].mock.calls[0][0] as string;
const body = (method: 'post' | 'patch' | 'put') => client.api[method].mock.calls[0][1];
const config = (method: 'post' | 'put') => client.api[method].mock.calls[0][2];

describe('http/api', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('auth service', () => {
        it('should log in', () => {
            api.login({ email: 'a@b.test', password: 'secret' });

            expect(url('post')).toBe('/api/auth/auth/login');
            expect(body('post')).toEqual({ email: 'a@b.test', password: 'secret' });
        });

        it('should double up the auth segment', () => {
            // Not a typo: the gateway prefix is `/api/auth` and auth-service's
            // own router is mounted at `/auth`.
            api.self();

            expect(url('get')).toBe('/api/auth/auth/self');
        });

        it('should log out with no body', () => {
            api.logout();

            expect(url('post')).toBe('/api/auth/auth/logout');
        });

        it('should pass the query string through untouched for users', () => {
            api.getUsers('perPage=6&currentPage=2&q=swarup');

            expect(url('get')).toBe('/api/auth/users?perPage=6&currentPage=2&q=swarup');
        });

        it('should pass the query string through untouched for tenants', () => {
            api.getTenants('perPage=100&currentPage=1');

            expect(url('get')).toBe('/api/auth/tenants?perPage=100&currentPage=1');
        });

        it('should leave a dangling ? for an empty query', () => {
            // Every caller builds its own string with URLSearchParams, and none
            // guards the empty case. Harmless — express ignores it — but it is
            // why the network tab shows `/users?`.
            api.getUsers('');

            expect(url('get')).toBe('/api/auth/users?');
        });

        it('should create a user', () => {
            const user = {
                email: 'new@test.com',
                firstName: 'New',
                lastName: 'User',
                password: 'secret',
                role: 'manager',
                tenantId: 3,
            };

            api.createUser(user);

            expect(url('post')).toBe('/api/auth/users');
            expect(body('post')).toEqual(user);
        });

        it('should update a user by id', () => {
            api.updateUser(
                {
                    email: 'e@test.com',
                    firstName: 'E',
                    lastName: 'F',
                    password: '',
                    role: 'manager',
                    tenantId: 3,
                },
                '42',
            );

            expect(url('patch')).toBe('/api/auth/users/42');
        });

        it('should create a tenant', () => {
            api.createTenant({ name: 'Pizza Palace', address: '12 Park Street' });

            expect(url('post')).toBe('/api/auth/tenants');
        });
    });

    describe('catalog service', () => {
        it('should list categories', () => {
            api.getCategories();

            expect(url('get')).toBe('/api/catalog/categories');
        });

        it('should fetch one category', () => {
            // Both Pricing and Attributes call this with the same query key and
            // a five-minute staleTime, so Query dedupes two components into one
            // request.
            api.getCategory('670000000000000000000009');

            expect(url('get')).toBe('/api/catalog/categories/670000000000000000000009');
        });

        it('should list products with filters', () => {
            api.getProducts('limit=6&page=1&tenantId=3');

            expect(url('get')).toBe('/api/catalog/products?limit=6&page=1&tenantId=3');
        });

        it('should post a product as multipart', () => {
            // The image forces this. `makeFormData` builds the body; the header
            // has to be set per-call because the shared instance defaults to
            // JSON.
            api.createProduct(new FormData());

            expect(url('post')).toBe('/api/catalog/products');
            expect(config('post')).toEqual({
                headers: { 'Content-Type': 'multipart/form-data' },
            });
        });

        it('should update a product with PUT, not PATCH', () => {
            // catelog-service's update route is a full replace — which is why
            // the edit drawer repopulates every field rather than sending a
            // delta.
            api.updateProduct(new FormData(), 'abc');

            expect(url('put')).toBe('/api/catalog/products/abc');
            expect(config('put')).toEqual({
                headers: { 'Content-Type': 'multipart/form-data' },
            });
        });
    });

    describe('order service', () => {
        it('should list orders', () => {
            api.getOrders('tenantId=10');

            expect(url('get')).toBe('/api/order/orders?tenantId=10');
        });

        it('should fetch one order with a field projection', () => {
            api.getSingle('abc', 'fields=orderStatus,total');

            expect(url('get')).toBe('/api/order/orders/abc?fields=orderStatus,total');
        });

        it('should change an order status', () => {
            api.changeStatus('abc', { status: 'confirmed' as never });

            expect(url('patch')).toBe('/api/order/orders/change-status/abc');
            expect(body('patch')).toEqual({ status: 'confirmed' });
        });
    });

    it('should export only the auth prefix', () => {
        // `AUTH_SERVICE` is exported because client.ts needs it to build the
        // refresh URL; the other two are module-private.
        expect(api.AUTH_SERVICE).toBe('/api/auth');
        expect(api).not.toHaveProperty('CATALOG_SERVICE');
        expect(api).not.toHaveProperty('ORDER_SERVICE');
    });
});
