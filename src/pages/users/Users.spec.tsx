import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({
    getUsers: vi.fn(),
    getTenants: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
}));
vi.mock('../../http/api', () => apiMock);

import Users from './Users';
import {
    ADMIN,
    MANAGER,
    axiosResponse,
    captureRejection,
    renderWithProviders,
} from '../../test-utils';
import type { User } from '../../types';

/**
 * One of only two pages carrying a real role gate. The list/filter/drawer shape
 * here is the one Tenants and Products both repeat, so the pagination and
 * debounce behaviour pinned below applies to all three.
 */

const USER = {
    id: 7,
    firstName: 'Meera',
    lastName: 'Rao',
    email: 'meera@test.com',
    role: 'manager',
    createdAt: '2026-01-01T00:00:00.000Z',
    tenant: { id: 3, name: 'Pizza Palace', address: '12 Park Street' },
} as unknown as User;

const TENANTS = { data: [{ id: 3, name: 'Pizza Palace', address: '12 Park Street' }] };

const renderUsers = (user = ADMIN) =>
    renderWithProviders(
        <Routes>
            <Route path="/users" element={<Users />} />
            <Route path="/" element={<div>dashboard home</div>} />
        </Routes>,
        { user, route: '/users' },
    );

const drawer = () => within(document.querySelector('.ant-drawer-body') as HTMLElement);

const lastQuery = () => {
    const calls = apiMock.getUsers.mock.calls;
    return Object.fromEntries(new URLSearchParams(calls[calls.length - 1][0] as string));
};

/**
 * rc-select opens on mousedown; the visible option carries the label as title.
 *
 * The label is matched against `<label>` elements only — UserForm has a card
 * *titled* "Role" as well as a field labelled "Role", so a plain text query
 * finds two.
 */
const chooseOption = async (label: string, option: string) => {
    const item = drawer()
        .getByText(label, { selector: 'label' })
        .closest('.ant-form-item') as HTMLElement;
    fireEvent.mouseDown(item.querySelector('.ant-select') as HTMLElement);
    const choice = await waitFor(() => {
        const found = document.querySelector(
            `.ant-select-dropdown .ant-select-item-option[title="${option}"]`,
        );
        expect(found).not.toBeNull();
        return found as HTMLElement;
    });
    fireEvent.click(choice);
};

describe('Users', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        apiMock.getUsers.mockResolvedValue(axiosResponse({ data: [USER], total: 1 }));
        apiMock.getTenants.mockResolvedValue(axiosResponse(TENANTS));
        apiMock.createUser.mockResolvedValue(axiosResponse({}));
        apiMock.updateUser.mockResolvedValue(axiosResponse({}));
    });

    describe('the role gate', () => {
        it('should send a manager back to the dashboard', () => {
            // A real guard, and one of only two in the app — Tenants has the
            // same, Products and Orders have none.
            renderUsers(MANAGER);

            expect(screen.getByText('dashboard home')).toBeInTheDocument();
        });

        it('should still fetch the user list for a manager before redirecting', async () => {
            // The `if (user?.role !== 'admin')` return sits *below* the hooks —
            // it has to, since hooks cannot be conditional. So a manager who
            // reaches this route fires the request anyway and only then gets
            // sent away. auth-service answers it with a 403, so nothing leaks,
            // but the guard is cosmetic on the client and the real protection
            // is entirely server-side.
            renderUsers(MANAGER);

            await waitFor(() => expect(apiMock.getUsers).toHaveBeenCalled());
        });

        it('should let an admin through', async () => {
            renderUsers(ADMIN);

            expect(await screen.findByText('meera@test.com')).toBeInTheDocument();
        });

        it('should not fetch the tenant list for a manager', () => {
            // `getTenants` lives in UserForm, which only mounts inside the
            // drawer — so the redirect happens long before it could run.
            renderUsers(MANAGER);

            expect(apiMock.getTenants).not.toHaveBeenCalled();
        });
    });

    describe('the table', () => {
        it('should show a user', async () => {
            renderUsers();

            expect(await screen.findByText('Meera Rao')).toBeInTheDocument();
        });

        it('should show their restaurant', async () => {
            renderUsers();

            expect(await screen.findByText('Pizza Palace')).toBeInTheDocument();
        });

        it('should cope with a user who has no restaurant', async () => {
            apiMock.getUsers.mockResolvedValue(
                axiosResponse({ data: [{ ...USER, tenant: null }], total: 1 }),
            );
            renderUsers();

            expect(await screen.findByText('Meera Rao')).toBeInTheDocument();
        });

        it('should page six at a time', async () => {
            renderUsers();

            await waitFor(() =>
                expect(lastQuery()).toMatchObject({ perPage: '6', currentPage: '1' }),
            );
        });

        it('should show a fetch error', async () => {
            apiMock.getUsers.mockRejectedValue(new Error('Gateway timeout'));
            renderUsers();

            expect(await screen.findByText('Gateway timeout')).toBeInTheDocument();
        });
    });

    describe('filtering', () => {
        it('should debounce the search box', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            renderUsers();
            await screen.findByText('Meera Rao');
            const before = apiMock.getUsers.mock.calls.length;

            await userEvent
                .setup({ advanceTimers: vi.advanceTimersByTime })
                .type(screen.getByPlaceholderText('Search'), 'meera');

            expect(apiMock.getUsers).toHaveBeenCalledTimes(before);

            await vi.advanceTimersByTimeAsync(600);
            await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'meera' }));
            vi.useRealTimers();
        });

        it('should not debounce the role dropdown', async () => {
            // `onFilterChange` branches on `'q' in changedFilterFields` —
            // typing should not fire a request per keystroke, but picking a
            // role should be immediate.
            renderUsers();
            await screen.findByText('Meera Rao');

            const filter = screen.getByText('Select role').closest('.ant-select') as HTMLElement;
            fireEvent.mouseDown(filter);
            const option = await waitFor(() => {
                const found = document.querySelector(
                    '.ant-select-dropdown .ant-select-item-option[title="Manager"]',
                );
                expect(found).not.toBeNull();
                return found as HTMLElement;
            });
            fireEvent.click(option);

            await waitFor(() => expect(lastQuery()).toMatchObject({ role: 'manager' }));
        });

        it('should reset to page one whenever a filter changes', async () => {
            renderUsers();
            await screen.findByText('Meera Rao');

            const filter = screen.getByText('Select role').closest('.ant-select') as HTMLElement;
            fireEvent.mouseDown(filter);
            const option = await waitFor(() => {
                const found = document.querySelector(
                    '.ant-select-dropdown .ant-select-item-option[title="Admin"]',
                );
                expect(found).not.toBeNull();
                return found as HTMLElement;
            });
            fireEvent.click(option);

            await waitFor(() => expect(lastQuery()).toMatchObject({ currentPage: '1' }));
        });
    });

    describe('creating a user', () => {
        const openDrawer = async () => {
            const user = userEvent.setup({ pointerEventsCheck: 0 });
            await screen.findByText('Meera Rao');
            await user.click(screen.getByRole('button', { name: /Add User/ }));
            return user;
        };

        it('should open in create mode', async () => {
            renderUsers();
            await openDrawer();

            // "Add User" is both the button and the drawer title, so the title
            // is addressed directly.
            expect(
                await waitFor(() => document.querySelector('.ant-drawer-title')),
            ).toHaveTextContent('Add User');
        });

        it('should ask for a password', async () => {
            renderUsers();
            await openDrawer();

            expect(drawer().getByText('Security info')).toBeInTheDocument();
        });

        it('should post the new user', async () => {
            renderUsers();
            const user = await openDrawer();

            await user.type(drawer().getByLabelText('First name'), 'New');
            await user.type(drawer().getByLabelText('Last name'), 'Person');
            await user.type(drawer().getByLabelText('Email'), 'new@test.com');
            await user.type(drawer().getByLabelText('Passoword'), 'secret123');
            await chooseOption('Role', 'Manager');
            // The Restaurant field is conditional on the role — UserForm watches
            // `role` and only renders it for a manager.
            await waitFor(() =>
                expect(drawer().getByText('Restaurant', { selector: 'label' })).toBeInTheDocument(),
            );
            await chooseOption('Restaurant', 'Pizza Palace');

            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() =>
                expect(apiMock.createUser).toHaveBeenCalledWith(
                    expect.objectContaining({
                        firstName: 'New',
                        lastName: 'Person',
                        email: 'new@test.com',
                        role: 'manager',
                        tenantId: 3,
                    }),
                ),
            );
        });

        it('should refresh the list afterwards', async () => {
            renderUsers();
            const user = await openDrawer();
            const before = apiMock.getUsers.mock.calls.length;

            await user.type(drawer().getByLabelText('First name'), 'New');
            await user.type(drawer().getByLabelText('Last name'), 'Person');
            await user.type(drawer().getByLabelText('Email'), 'new@test.com');
            await user.type(drawer().getByLabelText('Passoword'), 'secret123');
            await chooseOption('Role', 'Manager');
            // The Restaurant field is conditional on the role — UserForm watches
            // `role` and only renders it for a manager.
            await waitFor(() =>
                expect(drawer().getByText('Restaurant', { selector: 'label' })).toBeInTheDocument(),
            );
            await chooseOption('Restaurant', 'Pizza Palace');
            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() => expect(apiMock.getUsers.mock.calls.length).toBeGreaterThan(before));
        });

        it('should not submit an incomplete form', async () => {
            renderUsers();
            const user = await openDrawer();

            await captureRejection(() =>
                user.click(screen.getByRole('button', { name: 'Submit' })),
            );

            await waitFor(() =>
                expect(drawer().getByText('First name is required')).toBeInTheDocument(),
            );
            expect(apiMock.createUser).not.toHaveBeenCalled();
        });

        it('should leave the validation failure as an unhandled rejection', async () => {
            // BUG, captured rather than asserted as correct — the same missing
            // try/catch as Tenants. `await form.validateFields()` rejects on an
            // invalid form and nothing catches it, so every failed submit logs
            // an uncaught error to the console.
            renderUsers();
            const user = await openDrawer();

            const rejection = await captureRejection(() =>
                user.click(screen.getByRole('button', { name: 'Submit' })),
            );

            expect(rejection?.errorFields?.length).toBeGreaterThan(0);
        });

        it('should misspell the password label', async () => {
            // "Passoword". Cosmetic, but it is what a screen reader announces
            // and what any label-based query has to match.
            renderUsers();
            await openDrawer();

            expect(drawer().getByText('Passoword')).toBeInTheDocument();
        });
    });

    describe('editing a user', () => {
        const openEdit = async () => {
            const user = userEvent.setup({ pointerEventsCheck: 0 });
            await screen.findByText('Meera Rao');
            await user.click(screen.getByRole('button', { name: 'Edit' }));
            return user;
        };

        it('should open in edit mode', async () => {
            renderUsers();
            await openEdit();

            expect(await screen.findByText('Edit User')).toBeInTheDocument();
        });

        it('should prefill the form', async () => {
            renderUsers();
            await openEdit();

            expect(await drawer().findByDisplayValue('Meera')).toBeInTheDocument();
            expect(drawer().getByDisplayValue('meera@test.com')).toBeInTheDocument();
        });

        it('should hide the password field', async () => {
            // auth-service's update endpoint does not accept one.
            renderUsers();
            await openEdit();

            await screen.findByText('Edit User');
            expect(drawer().queryByText('Security info')).not.toBeInTheDocument();
        });

        it('should PATCH rather than POST', async () => {
            renderUsers();
            const user = await openEdit();
            await drawer().findByDisplayValue('Meera');

            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() =>
                expect(apiMock.updateUser).toHaveBeenCalledWith(expect.anything(), USER.id),
            );
            expect(apiMock.createUser).not.toHaveBeenCalled();
        });

        it('should close the drawer even when the update fails', async () => {
            // BUG, captured rather than asserted as correct. `onHandleSubmit`
            // awaits `updateUserMutation(...)`, but a TanStack `mutate` returns
            // void and never rejects — so the lines after it always run. The
            // drawer closes and the form resets on failure exactly as on
            // success, and the admin is given no sign the change was rejected.
            //
            // `mutateAsync` inside a try/catch, or moving the reset into
            // `onSuccess`, is the fix.
            apiMock.updateUser.mockRejectedValue(new Error('403'));
            renderUsers();
            const user = await openEdit();
            await drawer().findByDisplayValue('Meera');

            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() => expect(apiMock.updateUser).toHaveBeenCalled());
            await waitFor(() =>
                expect(document.querySelector('.ant-drawer-open')).not.toBeInTheDocument(),
            );
        });
    });
});
