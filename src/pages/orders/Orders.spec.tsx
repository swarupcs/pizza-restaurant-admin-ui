import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({ getOrders: vi.fn() }));
vi.mock('../../http/api', () => apiMock);

const socketMock = vi.hoisted(() => ({
    default: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));
vi.mock('../../lib/socket', () => socketMock);

import Orders from './Orders';
import socket from '../../lib/socket';
import { ADMIN, MANAGER, axiosResponse, renderWithProviders } from '../../test-utils';
import { OrderEvents, OrderStatus, PaymentMode, PaymentStatus, type Order } from '../../types';

/**
 * The live order board. Two things are worth testing beyond the table: which
 * tenant it asks for, and what the socket feed does with each event.
 *
 * `lib/socket.ts` opens its connection at module scope, so it is replaced
 * wholesale here — otherwise importing this page would try to reach ws-service.
 */

const ORDER = {
    _id: '670000000000000000000001',
    customerId: { _id: 'c1', firstName: 'Ari', lastName: 'Roy' },
    address: '12 Park Street, Kolkata',
    comment: 'Ring twice',
    paymentMode: PaymentMode.CASH,
    orderStatus: 'received',
    paymentStatus: PaymentStatus.PENDING,
    total: 1162,
    tenantId: '3',
    // Deliberately without a trailing Z. `new Date(...)` parses an offsetless
    // string as local time, so the formatted output does not depend on the
    // machine's timezone — with a UTC instant this assertion would pass in
    // London and fail in Kolkata.
    createdAt: '2026-01-01T10:30:00',
} as unknown as Order;

const renderOrders = (user = MANAGER) => renderWithProviders(<Orders />, { user });

/** The `order-update` handler the page registered on the socket. */
const orderUpdateHandler = () => {
    const call = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        ([event]) => event === 'order-update',
    );
    return call?.[1] as (data: { event_type: string; data: Order }) => void;
};

describe('Orders', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        apiMock.getOrders.mockResolvedValue(axiosResponse([ORDER]));
    });

    describe('the table', () => {
        it('should render an order', async () => {
            renderOrders();

            expect(await screen.findByText(ORDER._id)).toBeInTheDocument();
        });

        it('should show the customer name', async () => {
            renderOrders();

            expect(await screen.findByText('Ari Roy')).toBeInTheDocument();
        });

        it('should survive an order whose customer is gone', async () => {
            // order-service populates `customerId`, and a deleted customer
            // leaves it null. The column guards for it — the only null guard in
            // the file.
            apiMock.getOrders.mockResolvedValue(axiosResponse([{ ...ORDER, customerId: null }]));
            renderOrders();

            expect(await screen.findByText(ORDER._id)).toBeInTheDocument();
        });

        it('should format the total in rupees', async () => {
            renderOrders();

            expect(await screen.findByText('₹1162')).toBeInTheDocument();
        });

        it('should format the timestamp', async () => {
            renderOrders();

            expect(await screen.findByText('01/01/2026 10:30')).toBeInTheDocument();
        });

        it('should capitalise the status', async () => {
            renderOrders();

            expect(await screen.findByText('Received')).toBeInTheDocument();
        });

        it('should link each row to its detail page', async () => {
            renderOrders();

            expect(await screen.findByText('Details')).toHaveAttribute(
                'href',
                `/orders/${ORDER._id}`,
            );
        });

        it('should render an uncoloured tag for an unmapped status', async () => {
            // BUG-adjacent, captured rather than asserted as correct.
            // `colorMapping[record.orderStatus]` has no fallback here, where
            // SingleOrder.tsx writes `?? 'processing'`. A status outside the
            // five known ones renders with no colour at all.
            apiMock.getOrders.mockResolvedValue(
                axiosResponse([{ ...ORDER, orderStatus: 'cancelled' }]),
            );
            renderOrders();

            const tag = await screen.findByText('Cancelled');
            expect(tag.className).not.toMatch(/ant-tag-(processing|success|orange|volcano|purple)/);
        });
    });

    describe('which orders it asks for', () => {
        it('should always request tenant 10', async () => {
            // BUG, captured rather than asserted as correct, and the reason this
            // page is non-functional for everyone.
            //
            //   // todo: make this dynamic.
            //   const TENANT_ID = 10;
            //
            // Every request is `getOrders('tenantId=10')` regardless of who is
            // signed in. A manager at restaurant 3 does not see their own
            // orders — they see restaurant 10's, or an empty table. The value
            // they need is `user.tenant.id`, which the socket `join` two lines
            // below already uses correctly.
            renderOrders(MANAGER);

            await waitFor(() => expect(apiMock.getOrders).toHaveBeenCalledWith('tenantId=10'));
        });

        it('should request tenant 10 for an admin too', async () => {
            renderOrders(ADMIN);

            await waitFor(() => expect(apiMock.getOrders).toHaveBeenCalledWith('tenantId=10'));
        });

        it('should offer no way to change the tenant', async () => {
            // There is no filter bar on this page at all, unlike Products,
            // Users and Tenants.
            renderOrders(ADMIN);

            await screen.findByText(ORDER._id);
            expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument();
        });
    });

    describe('the live feed', () => {
        it('should join the room for the manager’s restaurant', async () => {
            renderOrders(MANAGER);

            expect(socket.emit).toHaveBeenCalledWith('join', { tenantId: 3 });
        });

        it('should subscribe to order-update', () => {
            renderOrders(MANAGER);

            expect(socket.on).toHaveBeenCalledWith('order-update', expect.any(Function));
        });

        it('should not connect anything for an admin', () => {
            // BUG-adjacent, captured rather than asserted as correct. The whole
            // block is inside `if (user?.tenant)` and an admin has no tenant, so
            // an admin gets no live updates and no indication why. Defensible —
            // there is no single room for them to join — but it means the
            // feature silently does nothing for half the users.
            renderOrders(ADMIN);

            expect(socket.emit).not.toHaveBeenCalled();
            expect(socket.on).not.toHaveBeenCalled();
        });

        it('should unsubscribe on unmount', () => {
            const { unmount } = renderOrders(MANAGER);

            unmount();

            expect(socket.off).toHaveBeenCalledWith('join');
            expect(socket.off).toHaveBeenCalledWith('order-update');
        });

        it('should prepend a new cash order', async () => {
            const { queryClient } = renderOrders(MANAGER);
            await screen.findByText(ORDER._id);

            orderUpdateHandler()({
                event_type: OrderEvents.ORDER_CREATE,
                data: { ...ORDER, _id: 'new-order' },
            });

            await waitFor(() =>
                expect((queryClient.getQueryData(['orders']) as Order[])[0]._id).toBe('new-order'),
            );
        });

        it('should show a toast for a new order', async () => {
            renderOrders(MANAGER);
            await screen.findByText(ORDER._id);

            orderUpdateHandler()({
                event_type: OrderEvents.ORDER_CREATE,
                data: { ...ORDER, _id: 'new-order' },
            });

            expect(await screen.findByText('New Order Received.')).toBeInTheDocument();
        });

        it('should prepend a paid card order', async () => {
            // The second of the two events that mean "this order is now real
            // and payable".
            const { queryClient } = renderOrders(MANAGER);
            await screen.findByText(ORDER._id);

            orderUpdateHandler()({
                event_type: OrderEvents.PAYMENT_STATUS_UPDATE,
                data: {
                    ...ORDER,
                    _id: 'paid-card',
                    paymentMode: PaymentMode.CARD,
                    paymentStatus: PaymentStatus.PAID,
                },
            });

            await waitFor(() =>
                expect((queryClient.getQueryData(['orders']) as Order[])[0]._id).toBe('paid-card'),
            );
        });

        it('should ignore an unpaid card order', async () => {
            // Deliberate: a card order exists the moment it is created but is
            // not payable until Stripe confirms. Showing it early would put
            // orders on the board that may never be paid for.
            const { queryClient } = renderOrders(MANAGER);
            await screen.findByText(ORDER._id);

            orderUpdateHandler()({
                event_type: OrderEvents.ORDER_CREATE,
                data: { ...ORDER, _id: 'unpaid-card', paymentMode: PaymentMode.CARD },
            });

            expect(queryClient.getQueryData(['orders'])).toHaveLength(1);
        });

        it('should ignore a status update', async () => {
            const { queryClient } = renderOrders(MANAGER);
            await screen.findByText(ORDER._id);

            orderUpdateHandler()({
                event_type: OrderEvents.ORDER_STATUS_UPDATE,
                data: { ...ORDER, orderStatus: OrderStatus.PREPARED },
            });

            expect(queryClient.getQueryData(['orders'])).toHaveLength(1);
        });

        it('should log every event it receives, filtered or not', async () => {
            // On the hot path, and the payload carries the customer's name and
            // delivery address.
            renderOrders(MANAGER);
            await screen.findByText(ORDER._id);

            orderUpdateHandler()({
                event_type: OrderEvents.ORDER_STATUS_UPDATE,
                data: ORDER,
            });

            expect(console.log).toHaveBeenCalledWith('data received: ', expect.anything());
        });

        it('should throw when an event arrives before the first fetch', async () => {
            // BUG, captured rather than asserted as correct.
            //
            //   queryClient.setQueryData(['orders'], (old: Order[]) => [data.data, ...old])
            //
            // `old` is undefined until the initial query resolves, and spreading
            // undefined throws — inside a socket callback, where nothing catches
            // it. A new order arriving in the second before the table loads
            // takes out the page. `[data.data, ...(old ?? [])]` is the fix.
            let pending!: (value: unknown) => void;
            apiMock.getOrders.mockReturnValue(new Promise((resolve) => (pending = resolve)));

            renderOrders(MANAGER);

            expect(() =>
                orderUpdateHandler()({
                    event_type: OrderEvents.ORDER_CREATE,
                    data: ORDER,
                }),
            ).toThrow();

            pending(axiosResponse([ORDER]));
        });
    });
});
