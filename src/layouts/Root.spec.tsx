import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Outlet, Route, Routes } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ self: vi.fn() }));
vi.mock('../http/api', () => apiMock);

import Root from './Root';
import { useAuthStore } from '../store';
import { ADMIN, axiosError, axiosResponse, renderWithProviders } from '../test-utils';

/**
 * `Root` is a gate disguised as a layout. It sits at "/" and blocks every child
 * route until `/auth/self` has settled, which is what lets `Dashboard` do a
 * plain `if (user === null)` check with no race against the session lookup.
 */

const renderRoot = () =>
    renderWithProviders(
        <Routes>
            <Route path="/" element={<Root />}>
                <Route index element={<div>child route</div>} />
            </Route>
        </Routes>,
    );

describe('Root', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMock.self.mockResolvedValue(axiosResponse(ADMIN));
    });

    describe('while the session is unknown', () => {
        it('should render a loading placeholder', () => {
            renderRoot();

            expect(screen.getByText('Loading...')).toBeInTheDocument();
        });

        it('should not render the child route yet', () => {
            // The whole point of the gate: no page can render, and therefore no
            // page can wrongly redirect to login, before the user is known.
            renderRoot();

            expect(screen.queryByText('child route')).not.toBeInTheDocument();
        });

        it('should render a bare div rather than a spinner', () => {
            // antd is available and every other loading state in the app uses
            // its Spin. This one is `<div>Loading...</div>` — the first thing a
            // returning admin sees on every page load.
            renderRoot();

            expect(screen.getByText('Loading...').tagName).toBe('DIV');
        });
    });

    describe('when the session is valid', () => {
        it('should ask auth-service who the caller is', async () => {
            renderRoot();

            await waitFor(() => expect(apiMock.self).toHaveBeenCalledTimes(1));
        });

        it('should commit the user to the store', async () => {
            renderRoot();

            await waitFor(() => expect(useAuthStore.getState().user).toEqual(ADMIN));
        });

        it('should render the child route', async () => {
            renderRoot();

            expect(await screen.findByText('child route')).toBeInTheDocument();
        });
    });

    describe('when the caller is not logged in', () => {
        beforeEach(() => {
            apiMock.self.mockRejectedValue(axiosError(401));
        });

        it('should not retry a 401', async () => {
            // A 401 is not a failure to retry — it is the answer, and it means
            // "not logged in". Without this branch an anonymous visitor would
            // sit on "Loading..." through four sequential 401s before the login
            // form appeared.
            renderRoot();

            await waitFor(() => expect(screen.getByText('child route')).toBeInTheDocument());
            expect(apiMock.self).toHaveBeenCalledTimes(1);
        });

        it('should leave the store empty', async () => {
            renderRoot();

            await screen.findByText('child route');
            expect(useAuthStore.getState().user).toBeNull();
        });

        it('should still render the child so it can redirect to login', async () => {
            // `Root` itself never redirects. It renders the outlet and lets
            // `Dashboard` decide — which is what makes `returnTo` possible.
            renderRoot();

            expect(await screen.findByText('child route')).toBeInTheDocument();
        });
    });

    describe('when the lookup fails for another reason', () => {
        it('should retry a 500 three times before giving up', async () => {
            // Four calls in total. A gateway hiccup or a cold start should not
            // log an admin out mid-session.
            apiMock.self.mockRejectedValue(axiosError(500));

            renderRoot();

            await waitFor(() => expect(apiMock.self).toHaveBeenCalledTimes(4), { timeout: 10_000 });
        }, 15_000);

        it('should retry a network error with no response', async () => {
            // `error instanceof AxiosError` is false for a plain Error, so the
            // 401 short-circuit is skipped and the default retry applies. That
            // happens to be the right behaviour, but it is a consequence of the
            // instanceof check rather than a decision — a real AxiosError with
            // `response: undefined` takes the same path.
            apiMock.self.mockRejectedValue(new Error('Network Error'));

            renderRoot();

            await waitFor(() => expect(apiMock.self).toHaveBeenCalledTimes(4), { timeout: 10_000 });
        }, 15_000);
    });

    it('should not re-set the user when the query result is unchanged', async () => {
        // The effect depends on `data`, and Query hands back the same object
        // reference until it refetches — so this does not loop.
        const setUser = vi.spyOn(useAuthStore.getState(), 'setUser');

        renderRoot();
        await screen.findByText('child route');

        expect(setUser.mock.calls.length).toBeLessThanOrEqual(1);
    });
});

describe('Root as a layout', () => {
    it('should render whatever the outlet resolves to', async () => {
        apiMock.self.mockResolvedValue(axiosResponse(ADMIN));

        renderWithProviders(
            <Routes>
                <Route path="/" element={<Root />}>
                    <Route
                        index
                        element={
                            <div>
                                nested <Outlet />
                            </div>
                        }
                    />
                </Route>
            </Routes>,
        );

        expect(await screen.findByText(/nested/)).toBeInTheDocument();
    });
});
