import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({ getSingle: vi.fn(), changeStatus: vi.fn() }));
vi.mock('../../http/api', () => apiMock);

import SingleOrder from './SingleOrder';
import { MANAGER, axiosResponse, renderWithProviders } from '../../test-utils';
import { OrderStatus, PaymentMode, PaymentStatus, type Order } from '../../types';

const ORDER_ID = '670000000000000000000001';

const ORDER = {
    _id: ORDER_ID,
    customerId: { _id: 'c1', firstName: 'Ari', lastName: 'Roy' },
    cart: [
        {
            _id: 'p1',
            name: 'Margherita',
            image: 'https://example.test/pizza.png',
            priceConfiguration: {},
            chosenConfiguration: {
                priceConfiguration: { Size: 'Large', Crust: 'Thick' },
                selectedToppings: [{ id: 't1', name: 'Cheese', price: 50, image: '' }],
            },
            qty: 2,
        },
    ],
    address: '12 Park Street, Kolkata',
    comment: 'Ring twice',
    paymentMode: PaymentMode.CASH,
    orderStatus: OrderStatus.RECEIVED,
    paymentStatus: PaymentStatus.PENDING,
    total: 1162,
    tenantId: '3',
    createdAt: '2026-01-01T10:30:00',
} as unknown as Order;

const renderOrder = () =>
    renderWithProviders(<SingleOrder />, {
        user: MANAGER,
        route: `/orders/${ORDER_ID}`,
        path: '/orders/:orderId',
    });

describe('SingleOrder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMock.getSingle.mockResolvedValue(axiosResponse(ORDER));
        apiMock.changeStatus.mockResolvedValue(axiosResponse({}));
    });

    describe('loading', () => {
        it('should render nothing until the order arrives', () => {
            renderOrder();

            expect(screen.queryByText('Order Details')).not.toBeInTheDocument();
        });

        it('should take the order id from the route', async () => {
            renderOrder();

            await waitFor(() =>
                expect(apiMock.getSingle).toHaveBeenCalledWith(ORDER_ID, expect.any(String)),
            );
        });

        it('should request an explicit field projection', async () => {
            // order-service returns only what is asked for — plus `customerId`,
            // which it seeds into the projection and populates unconditionally.
            // That is why the list below does not mention it and the customer
            // card still renders.
            renderOrder();

            await waitFor(() => expect(apiMock.getSingle).toHaveBeenCalled());
            const fields = new URLSearchParams(apiMock.getSingle.mock.calls[0][1] as string).get(
                'fields',
            );

            expect(fields?.split(',')).toEqual([
                'cart',
                'address',
                'paymentMode',
                'tenantId',
                'total',
                'comment',
                'orderStatus',
                'paymentStatus',
                'createdAt',
            ]);
            expect(fields).not.toContain('customerId');
        });
    });

    describe('the order details', () => {
        it('should list each cart line', async () => {
            renderOrder();

            expect(await screen.findByText('Margherita')).toBeInTheDocument();
        });

        it('should show the chosen configuration', async () => {
            renderOrder();

            expect(await screen.findByText('Large, Thick')).toBeInTheDocument();
        });

        it('should list the selected toppings', async () => {
            // There is a `todo: IMPORTANT: check why there is a nested array in
            // selected toppings` on this line — a question about client-ui's
            // cart shape rather than this file. With a flat array it renders as
            // expected.
            renderOrder();

            expect(await screen.findByText('Cheese')).toBeInTheDocument();
        });

        it('should pluralise the quantity', async () => {
            renderOrder();

            expect(await screen.findByText('2 Items')).toBeInTheDocument();
        });

        it('should not pluralise a single item', async () => {
            apiMock.getSingle.mockResolvedValue(
                axiosResponse({ ...ORDER, cart: [{ ...ORDER.cart[0], qty: 1 }] }),
            );
            renderOrder();

            expect(await screen.findByText('1 Item')).toBeInTheDocument();
        });
    });

    describe('the customer card', () => {
        it('should show the name', async () => {
            renderOrder();

            expect(await screen.findByText('Ari Roy')).toBeInTheDocument();
        });

        it('should show the address and total', async () => {
            renderOrder();

            expect(await screen.findByText('12 Park Street, Kolkata')).toBeInTheDocument();
            expect(screen.getByText('₹1162')).toBeInTheDocument();
        });

        it('should upper-case the payment mode', async () => {
            renderOrder();

            expect(await screen.findByText('CASH')).toBeInTheDocument();
        });

        it('should show the comment when there is one', async () => {
            renderOrder();

            expect(await screen.findByText('Ring twice')).toBeInTheDocument();
        });

        it('should hide the comment section when there is none', async () => {
            apiMock.getSingle.mockResolvedValue(axiosResponse({ ...ORDER, comment: undefined }));
            renderOrder();

            await screen.findByText('Ari Roy');
            expect(screen.queryByText('Comment')).not.toBeInTheDocument();
        });

        it('should crash when the customer has been deleted', async () => {
            // BUG, captured rather than asserted as correct. `order.customerId.firstName`
            // is read with no guard, where the Orders table one route away does
            // check. order-service populates a deleted reference as null, so a
            // customer removed after ordering makes this page throw rather than
            // render.
            apiMock.getSingle.mockResolvedValue(axiosResponse({ ...ORDER, customerId: null }));
            vi.spyOn(console, 'error').mockImplementation(() => undefined);

            renderOrder();

            // The read throws while React is rendering the customer card, so
            // the whole page is torn down: the cart card that had already been
            // built never reaches the DOM either.
            await waitFor(() => expect(apiMock.getSingle).toHaveBeenCalled());
            expect(screen.queryByText('Order Details')).not.toBeInTheDocument();
            expect(screen.queryByText('Margherita')).not.toBeInTheDocument();
        });
    });

    describe('changing the status', () => {
        const chooseStatus = async (label: string) => {
            const select = document.querySelector('.ant-select') as HTMLElement;
            fireEvent.mouseDown(select);
            const option = await waitFor(() => {
                const found = document.querySelector(
                    `.ant-select-dropdown .ant-select-item-option[title="${label}"]`,
                );
                expect(found).not.toBeNull();
                return found as HTMLElement;
            });
            fireEvent.click(option);
        };

        it('should default to the current status', async () => {
            renderOrder();

            await screen.findByText('Order Details');
            expect(document.querySelector('.ant-select-content')).toHaveTextContent('Received');
        });

        it('should patch the new status', async () => {
            renderOrder();
            await screen.findByText('Order Details');

            await chooseStatus('Confirmed');

            await waitFor(() =>
                expect(apiMock.changeStatus).toHaveBeenCalledWith(ORDER_ID, {
                    status: 'confirmed',
                }),
            );
        });

        it('should refetch the order afterwards', async () => {
            renderOrder();
            await screen.findByText('Order Details');

            await chooseStatus('Prepared');

            await waitFor(() => expect(apiMock.getSingle).toHaveBeenCalledTimes(2));
        });

        it('should offer every status including going backwards', async () => {
            // The dropdown is a flat list with no transition rules, so an order
            // can be moved from Delivered back to Received. order-service does
            // not constrain the sequence either.
            renderOrder();
            await screen.findByText('Order Details');

            const select = document.querySelector('.ant-select') as HTMLElement;
            fireEvent.mouseDown(select);

            await waitFor(() =>
                expect(document.querySelectorAll('.ant-select-item-option')).toHaveLength(5),
            );
        });

        it('should leave the dropdown showing the new status even if the patch fails', async () => {
            // BUG, captured rather than asserted as correct. The mutation has no
            // `onError`, and the Select is uncontrolled (`defaultValue`), so a
            // rejected PATCH leaves the control displaying a status the order
            // does not have. A manager can believe they marked an order
            // delivered when the server refused.
            apiMock.changeStatus.mockRejectedValue(new Error('403'));
            renderOrder();
            await screen.findByText('Order Details');

            await chooseStatus('Delivered');

            await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalled());
            expect(document.querySelector('.ant-select-content')).toHaveTextContent('Delivered');
        });
    });
});
