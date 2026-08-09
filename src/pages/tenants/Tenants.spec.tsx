import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ getTenants: vi.fn(), createTenant: vi.fn() }));
vi.mock('../../http/api', () => apiMock);

import Tenants from './Tenants';
import {
    ADMIN,
    MANAGER,
    axiosResponse,
    captureRejection,
    renderWithProviders,
} from '../../test-utils';

/**
 * The same list/filter/drawer shape as Users, with two differences worth
 * pinning: there is no edit path at all, and the search filter does *not* reset
 * the page.
 */

const TENANT = { id: 3, name: 'Pizza Palace', address: '12 Park Street' };

const renderTenants = (user = ADMIN) =>
    renderWithProviders(
        <Routes>
            <Route path="/restaurants" element={<Tenants />} />
            <Route path="/" element={<div>dashboard home</div>} />
        </Routes>,
        { user, route: '/restaurants' },
    );

const drawer = () => within(document.querySelector('.ant-drawer-body') as HTMLElement);

const lastQuery = () => {
    const calls = apiMock.getTenants.mock.calls;
    return Object.fromEntries(new URLSearchParams(calls[calls.length - 1][0] as string));
};

describe('Tenants', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        apiMock.getTenants.mockResolvedValue(axiosResponse({ data: [TENANT], total: 1 }));
        apiMock.createTenant.mockResolvedValue(axiosResponse({}));
    });

    describe('the role gate', () => {
        it('should send a manager back to the dashboard', () => {
            renderTenants(MANAGER);

            expect(screen.getByText('dashboard home')).toBeInTheDocument();
        });

        it('should let an admin through', async () => {
            renderTenants(ADMIN);

            expect(await screen.findByText('Pizza Palace')).toBeInTheDocument();
        });
    });

    describe('the table', () => {
        it('should list restaurants', async () => {
            renderTenants();

            expect(await screen.findByText('Pizza Palace')).toBeInTheDocument();
            expect(screen.getByText('12 Park Street')).toBeInTheDocument();
        });

        it('should page six at a time', async () => {
            renderTenants();

            await waitFor(() =>
                expect(lastQuery()).toMatchObject({ perPage: '6', currentPage: '1' }),
            );
        });

        it('should show a fetch error', async () => {
            apiMock.getTenants.mockRejectedValue(new Error('Gateway timeout'));
            renderTenants();

            expect(await screen.findByText('Gateway timeout')).toBeInTheDocument();
        });
    });

    describe('filtering', () => {
        it('should debounce the search box', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            renderTenants();
            await screen.findByText('Pizza Palace');
            const before = apiMock.getTenants.mock.calls.length;

            await userEvent
                .setup({ advanceTimers: vi.advanceTimersByTime })
                .type(screen.getByPlaceholderText('Search'), 'palace');

            expect(apiMock.getTenants).toHaveBeenCalledTimes(before);

            await vi.advanceTimersByTimeAsync(600);
            await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'palace' }));
            vi.useRealTimers();
        });

        it('should stay on the current page when the search changes', async () => {
            // BUG, captured rather than asserted as correct. Users and Products
            // both add `currentPage: 1` / `page: 1` to their debounced update;
            // this one sets only `q`.
            //
            // So searching from page 2 keeps `currentPage: 2`, and a filter
            // matching a handful of restaurants returns an empty page 2 — the
            // admin sees no results for a search that did match.
            apiMock.getTenants.mockResolvedValue(axiosResponse({ data: [TENANT], total: 12 }));
            vi.useFakeTimers({ shouldAdvanceTime: true });
            renderTenants();
            await screen.findByText('Pizza Palace');

            const user = userEvent.setup({
                advanceTimers: vi.advanceTimersByTime,
                pointerEventsCheck: 0,
            });
            await user.click(screen.getByTitle('2'));
            await waitFor(() => expect(lastQuery()).toMatchObject({ currentPage: '2' }));

            await user.type(screen.getByPlaceholderText('Search'), 'palace');
            await vi.advanceTimersByTimeAsync(600);

            await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'palace' }));
            expect(lastQuery()).toMatchObject({ currentPage: '2' });
            vi.useRealTimers();
        });
    });

    describe('creating a restaurant', () => {
        const openDrawer = async () => {
            const user = userEvent.setup({ pointerEventsCheck: 0 });
            await screen.findByText('Pizza Palace');
            await user.click(screen.getByRole('button', { name: /Add Restaurant/ }));
            return user;
        };

        it('should open the drawer', async () => {
            renderTenants();
            await openDrawer();

            expect(
                await waitFor(() => document.querySelector('.ant-drawer-title')),
            ).toHaveTextContent('Create restaurant');
        });

        it('should post the new restaurant', async () => {
            renderTenants();
            const user = await openDrawer();

            await user.type(drawer().getByLabelText('Name'), 'Curry House');
            await user.type(drawer().getByLabelText('Address'), '9 Camac Street');
            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() =>
                expect(apiMock.createTenant).toHaveBeenCalledWith({
                    name: 'Curry House',
                    address: '9 Camac Street',
                }),
            );
        });

        it('should refresh the list afterwards', async () => {
            renderTenants();
            const user = await openDrawer();
            const before = apiMock.getTenants.mock.calls.length;

            await user.type(drawer().getByLabelText('Name'), 'Curry House');
            await user.type(drawer().getByLabelText('Address'), '9 Camac Street');
            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() =>
                expect(apiMock.getTenants.mock.calls.length).toBeGreaterThan(before),
            );
        });

        it('should require both fields', async () => {
            renderTenants();
            const user = await openDrawer();

            await captureRejection(() =>
                user.click(screen.getByRole('button', { name: 'Submit' })),
            );

            expect(await drawer().findByText('Name is required')).toBeInTheDocument();
            expect(drawer().getByText('Address is required')).toBeInTheDocument();
            expect(apiMock.createTenant).not.toHaveBeenCalled();
        });

        it('should leave the validation failure as an unhandled rejection', async () => {
            // BUG, captured rather than asserted as correct.
            //
            //   const onHandleSubmit = async () => {
            //     await form.validateFields();
            //     ...
            //
            // `validateFields` *rejects* when the form is invalid, and nothing
            // catches it. The messages still render — antd does that itself —
            // but the click handler's promise rejects unhandled, so every failed
            // submit logs an uncaught error to the browser console and would
            // trip any error-reporting integration. A try/catch, or a plain
            // `.catch(() => {})`, is the fix.
            renderTenants();
            const user = await openDrawer();

            const rejection = await captureRejection(() =>
                user.click(screen.getByRole('button', { name: 'Submit' })),
            );

            expect(rejection?.errorFields?.map((field) => field.name[0])).toEqual([
                'name',
                'address',
            ]);
        });

        it('should close the drawer even when the create fails', async () => {
            // BUG, captured rather than asserted as correct, and the same shape
            // as the one in Users.spec.tsx: `await tenantMutate(...)` awaits a
            // `mutate` that returns void and never rejects, so the lines after
            // it always run. A duplicate name that auth-service rejects still
            // closes the drawer and clears the form.
            apiMock.createTenant.mockRejectedValue(new Error('409'));
            renderTenants();
            const user = await openDrawer();

            await user.type(drawer().getByLabelText('Name'), 'Curry House');
            await user.type(drawer().getByLabelText('Address'), '9 Camac Street');
            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() => expect(apiMock.createTenant).toHaveBeenCalled());
            await waitFor(() =>
                expect(document.querySelector('.ant-drawer-open')).not.toBeInTheDocument(),
            );
        });

        it('should offer no way to edit an existing restaurant', async () => {
            // Unlike Users and Products, there is no Actions column and no
            // update endpoint wired up — a restaurant's name and address are
            // fixed once created.
            renderTenants();
            await screen.findByText('Pizza Palace');

            expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
        });
    });
});
