import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `axios.create` is replaced so the spec can capture the rejection handler the
 * module registers on the response interceptor, and call it directly. That is
 * the only way to exercise this file: the interceptor is installed as a side
 * effect of importing the module and is never exported.
 */
const axiosMock = vi.hoisted(() => {
    const instance = {
        request: vi.fn(),
        interceptors: { response: { use: vi.fn() } },
    };
    return {
        default: {
            // The parameter is declared so the spec can read back the config
            // the module passed; an argument-less `vi.fn` types `calls[0]` as
            // an empty tuple.
            create: vi.fn((_config?: Record<string, unknown>) => instance),
            post: vi.fn(),
        },
        __instance: instance,
    };
});
vi.mock('axios', () => axiosMock);

import { useAuthStore, type User } from '../store';

type Rejection = (error: unknown) => Promise<unknown>;

const ADMIN: User = {
    id: 1,
    firstName: 'A',
    lastName: 'B',
    email: 'a@b.test',
    role: 'admin',
};

/**
 * Import the module fresh and hand back the pieces the tests need. The
 * interceptor is registered at import time, so each test needs its own
 * registry.
 *
 * The store has to be re-imported from that same registry: after
 * `resetModules`, the top-level `useAuthStore` above is a *different* zustand
 * store than the one `client.ts` calls `logout()` on, so the logout assertions
 * would watch a store nothing ever touched.
 */
const freshClient = async () => {
    vi.resetModules();
    axiosMock.default.create.mockReturnValue(axiosMock.__instance);
    const module = await import('./client');
    const store = (await import('../store')).useAuthStore;
    store.setState({ user: ADMIN });
    const [onFulfilled, onRejected] = axiosMock.__instance.interceptors.response.use.mock
        .calls[0] as [(r: unknown) => unknown, Rejection];
    return { api: module.api, onFulfilled, onRejected, store };
};

describe('api client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuthStore.setState({ user: ADMIN });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    describe('construction', () => {
        it('should send cookies with every request', async () => {
            // The whole session model depends on this: auth-service sets
            // httpOnly cookies and nothing in this app ever handles a token.
            await freshClient();

            expect(axiosMock.default.create).toHaveBeenCalledWith(
                expect.objectContaining({ withCredentials: true }),
            );
        });

        it('should point at one origin rather than at each service', async () => {
            // Every call in http/api.ts is a path under this single base URL —
            // the app talks to the gateway and never to a service directly.
            // `import.meta.env.VITE_BACKEND_API_URL` is undefined under vitest,
            // so what is pinned is that the key is present and env-driven.
            await freshClient();

            const [config] = axiosMock.default.create.mock.calls[0];

            expect(config).toHaveProperty('baseURL');
        });

        it('should default to JSON', async () => {
            await freshClient();

            expect(axiosMock.default.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                }),
            );
        });
    });

    describe('a successful response', () => {
        it('should pass straight through', async () => {
            const { onFulfilled } = await freshClient();
            const response = { data: 'ok' };

            expect(onFulfilled(response)).toBe(response);
        });
    });

    describe('a 401', () => {
        it('should refresh and replay the original request', async () => {
            // This is what makes a 15-minute access token behave like an
            // indefinite session: the caller never sees the 401, and no
            // component contains a line about token expiry.
            const { onRejected } = await freshClient();
            axiosMock.default.post.mockResolvedValue({});
            axiosMock.__instance.request.mockResolvedValue({ data: 'replayed' });

            const result = await onRejected({
                response: { status: 401 },
                config: { url: '/api/auth/users', headers: { 'X-Trace': '1' } },
            });

            expect(axiosMock.default.post).toHaveBeenCalledWith(
                expect.stringContaining('/api/auth/auth/refresh'),
                {},
                { withCredentials: true },
            );
            expect(result).toEqual({ data: 'replayed' });
        });

        it('should refresh with a bare axios, not through itself', async () => {
            // Deliberate: routing the refresh through `api` would put the
            // refresh call under this same interceptor, so a failed refresh
            // would try to refresh itself.
            const { onRejected } = await freshClient();
            axiosMock.default.post.mockResolvedValue({});
            axiosMock.__instance.request.mockResolvedValue({});

            await onRejected({ response: { status: 401 }, config: { headers: {} } });

            expect(axiosMock.default.post).toHaveBeenCalled();
            expect(axiosMock.__instance.request).toHaveBeenCalledTimes(1);
        });

        it('should preserve the original headers on the replay', async () => {
            const { onRejected } = await freshClient();
            axiosMock.default.post.mockResolvedValue({});
            axiosMock.__instance.request.mockResolvedValue({});

            await onRejected({
                response: { status: 401 },
                config: { url: '/x', headers: { 'Content-Type': 'multipart/form-data' } },
            });

            const replayed = axiosMock.__instance.request.mock.calls[0][0] as {
                headers: Record<string, string>;
            };
            expect(replayed.headers['Content-Type']).toBe('multipart/form-data');
        });

        it('should mark the request so it is only ever retried once', async () => {
            // `_isRetry` is set on the *config*, so it rides along with the
            // replayed request. Without it an expired refresh token would
            // produce an infinite refresh loop.
            const { onRejected } = await freshClient();
            axiosMock.default.post.mockResolvedValue({});
            axiosMock.__instance.request.mockResolvedValue({});

            const config: Record<string, unknown> = { url: '/x', headers: {} };
            await onRejected({ response: { status: 401 }, config });

            expect(config._isRetry).toBe(true);
        });

        it('should not refresh a second time for an already-retried request', async () => {
            const { onRejected } = await freshClient();

            await expect(
                onRejected({
                    response: { status: 401 },
                    config: { url: '/x', headers: {}, _isRetry: true },
                }),
            ).rejects.toBeDefined();

            expect(axiosMock.default.post).not.toHaveBeenCalled();
        });
    });

    describe('when the refresh itself fails', () => {
        const failing = async () => {
            const { onRejected, store } = await freshClient();
            axiosMock.default.post.mockRejectedValue(new Error('refresh 401'));
            return { onRejected, store };
        };

        it('should log the user out', async () => {
            const { onRejected, store } = await failing();

            await onRejected({ response: { status: 401 }, config: { headers: {} } }).catch(
                () => undefined,
            );

            expect(store.getState().user).toBeNull();
        });

        it('should not replay the original request', async () => {
            const { onRejected } = await failing();

            await onRejected({ response: { status: 401 }, config: { headers: {} } }).catch(
                () => undefined,
            );

            expect(axiosMock.__instance.request).not.toHaveBeenCalled();
        });

        it('should reject with the refresh error rather than the original', async () => {
            // BUG, captured rather than asserted as correct. The caller asked
            // for `/api/order/orders` and is handed the error from
            // `/auth/refresh`, so whatever it renders — `error.message` in every
            // list page — describes a request the user never made.
            const { onRejected } = await failing();

            await expect(
                onRejected({
                    response: { status: 401 },
                    config: { url: '/api/order/orders', headers: {} },
                }),
            ).rejects.toThrow('refresh 401');
        });

        it('should reach the store without a React hook', async () => {
            // `useAuthStore.getState().logout()` — the non-hook accessor. This
            // is the only place the store is touched from outside React, and it
            // is why the interceptor can live in a plain module.
            const { onRejected, store } = await failing();

            await onRejected({ response: { status: 401 }, config: { headers: {} } }).catch(
                () => undefined,
            );

            expect(store.getState().user).toBeNull();
        });
    });

    describe('any other failure', () => {
        it('should pass a 403 through untouched', async () => {
            const { onRejected } = await freshClient();
            const error = { response: { status: 403 }, config: { headers: {} } };

            await expect(onRejected(error)).rejects.toBe(error);
            expect(axiosMock.default.post).not.toHaveBeenCalled();
        });

        it('should pass a 500 through untouched', async () => {
            const { onRejected } = await freshClient();
            const error = { response: { status: 500 }, config: { headers: {} } };

            await expect(onRejected(error)).rejects.toBe(error);
        });

        it('should leave the user logged in on a 500', async () => {
            const { onRejected, store } = await freshClient();

            await onRejected({ response: { status: 500 }, config: {} }).catch(() => undefined);

            expect(store.getState().user).toEqual(ADMIN);
        });

        it('should throw a TypeError when there is no response at all', async () => {
            // BUG, captured rather than asserted as correct.
            //
            //   if (error.response.status === 401 && ...)
            //
            // `error.response` is undefined for a network failure, a CORS
            // rejection, a timeout, or a request the browser cancelled. So
            // during a backend outage every single failed request surfaces as
            // "Cannot read properties of undefined (reading 'status')" instead
            // of the real error — and the pages that render `error.message`
            // show that string to the user.
            //
            // `error.response?.status` is the whole fix.
            const { onRejected } = await freshClient();

            await expect(
                onRejected({ message: 'Network Error', config: { headers: {} } }),
            ).rejects.toThrow(/Cannot read properties of undefined/);
        });
    });
});
