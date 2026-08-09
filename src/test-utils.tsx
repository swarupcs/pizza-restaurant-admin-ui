import React from 'react';
import { AxiosError, type AxiosResponse } from 'axios';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore, type User } from './store';

/**
 * Shared test helpers. This file is not a spec — it lives in `src` rather than
 * a `tests` directory to match the co-located `*.spec.tsx` convention the repo
 * already uses.
 */

export const ADMIN: User = {
    id: 1,
    firstName: 'Swarup',
    lastName: 'Das',
    email: 'admin@test.com',
    role: 'admin',
};

export const MANAGER: User = {
    id: 2,
    firstName: 'Meera',
    lastName: 'Rao',
    email: 'manager@test.com',
    role: 'manager',
    tenant: { id: 3, name: 'Pizza Palace', address: '12 Park Street' },
};

export const CUSTOMER: User = {
    id: 3,
    firstName: 'Ari',
    lastName: 'Roy',
    email: 'customer@test.com',
    role: 'customer',
};

type Options = {
    /** Seeds the zustand auth store before the first render. */
    user?: User | null;
    /** Initial history entry, for components that read the location. */
    route?: string;
    /** Path pattern to mount `ui` at, when the component reads route params. */
    path?: string;
};

/**
 * Renders a component with the three things `main.tsx` provides: a QueryClient,
 * a router, and (implicitly, via the module-level store) an auth user.
 *
 * A fresh QueryClient per render keeps tests isolated. `retry: false` makes a
 * failing query surface immediately rather than being retried in the background
 * past the end of the test — which matters here because `Root` deliberately
 * retries non-401 failures three times.
 */
export const renderWithProviders = (
    ui: React.ReactElement,
    { user = null, route = '/', path }: Options = {},
) => {
    useAuthStore.setState({ user });

    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const routed = path ? (
        <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
    ) : (
        ui
    );

    const result = render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[route]}>{routed}</MemoryRouter>
        </QueryClientProvider>,
    );

    return { ...result, queryClient };
};

/** An axios-shaped success, which is what every function in http/api returns. */
export const axiosResponse = <T,>(data: T) => ({ data });

/**
 * Runs `action` while capturing any unhandled promise rejection it provokes.
 *
 * Both drawer submit handlers do `await form.validateFields()` with no
 * try/catch, so failing validation produces a genuine unhandled rejection in
 * the browser — not just noise in the test run. Vitest reports those at run
 * level, where they cannot be asserted on, so its listeners are swapped out for
 * the duration and restored afterwards.
 */
export const captureRejection = async (action: () => Promise<void>) => {
    const existing = process.listeners('unhandledRejection');
    existing.forEach((listener) => process.off('unhandledRejection', listener));

    let captured: unknown;
    const record = (reason: unknown) => {
        captured = reason;
    };
    process.on('unhandledRejection', record);

    try {
        await action();
        // Rejections are reported on a later microtask than the click resolves.
        await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
        process.off('unhandledRejection', record);
        existing.forEach((listener) => process.on('unhandledRejection', listener));
    }

    return captured as { errorFields?: { name: string[]; errors: string[] }[] } | undefined;
};

/**
 * A real `AxiosError`, not an Error shaped like one.
 *
 * `Root`'s retry policy narrows with `error instanceof AxiosError` before it
 * looks at the status, so a hand-rolled object with a `response` property takes
 * the *retry* branch instead of the 401 short-circuit — and the spec would then
 * be testing the wrong path while still looking plausible.
 */
export const axiosError = (status: number, message = 'Request failed') =>
    new AxiosError(message, String(status), undefined, {}, {
        status,
        data: {},
        statusText: '',
        headers: {},
        config: {},
    } as AxiosResponse);
