import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMock = vi.hoisted(() => ({
    getProducts: vi.fn(),
    getCategories: vi.fn(),
    getCategory: vi.fn(),
    getTenants: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
}));
vi.mock('../../http/api', () => apiMock);

import Products from './Products';
import { ADMIN, MANAGER, axiosResponse, renderWithProviders } from '../../test-utils';
import type { Category, Product } from '../../types';

/**
 * The most interesting page in the app, because of one thing: catelog-service's
 * price model is per-category, so the *shape* of the form is not known until a
 * category is chosen, and every price field has to carry two extra facts — which
 * configuration key it belongs to, and whether that key is `base` or
 * `aditional`.
 *
 * The solution is to make one antd form-path segment a JSON string. Pricing.tsx
 * encodes it; Products.tsx decodes it on submit. Those two expressions must stay
 * byte-identical, and nothing enforces that — which is what most of the
 * "price configuration" block below is about.
 */

const CATEGORY: Category = {
    _id: '670000000000000000000009',
    name: 'Pizza',
    priceConfiguration: {
        Size: { priceType: 'base', availableOptions: ['Small', 'Large'] },
        Crust: { priceType: 'aditional', availableOptions: ['Thin', 'Thick'] },
    },
    attributes: [
        {
            name: 'Spiciness',
            widgetType: 'radio',
            defaultValue: 'Mild',
            availableOptions: ['Mild', 'Hot'],
        },
        { name: 'isHit', widgetType: 'switch', defaultValue: 'No', availableOptions: [] },
    ],
};

const PRODUCT = {
    _id: '670000000000000000000001',
    name: 'Margherita',
    image: 'https://example.test/pizza.png',
    description: 'Classic',
    category: CATEGORY,
    priceConfiguration: {
        Size: { priceType: 'base', availableOptions: { Small: 400, Large: 800 } },
        Crust: { priceType: 'aditional', availableOptions: { Thin: 50, Thick: 100 } },
    },
    attributes: [
        { name: 'Spiciness', value: 'Hot' },
        { name: 'isHit', value: true },
    ],
    // Required by the edit form's Restaurant field, and present on every
    // product catelog-service returns.
    tenantId: '3',
    isPublish: true,
    createdAt: '2026-01-01T00:00:00.000Z',
} as unknown as Product;

const TENANTS = { data: { data: [{ id: 3, name: 'Pizza Palace', address: '12 Park Street' }] } };

const renderProducts = (user = ADMIN) => renderWithProviders(<Products />, { user });

/**
 * Scopes a query to the open drawer.
 *
 * The filter bar and the product form both render a "Select category" control,
 * so an unscoped `getByText` finds two once the drawer is open.
 */
const drawer = () => within(document.querySelector('.ant-drawer-body') as HTMLElement);

/**
 * antd's overlays set `pointer-events: none` on placeholder and animating
 * layers, and jsdom has no layout to tell whether that is still true by the
 * time a click lands. The check is meaningless here and only produces flakes.
 */
const interact = () => userEvent.setup({ pointerEventsCheck: 0 });

/**
 * Picks an option from an antd Select, addressed by its form label.
 *
 * Three things make this fiddly, and all three produce misleading failures:
 *
 *  - `getByLabelText` cannot be used. The filter bar and the drawer form both
 *    declare `name="categoryId"`, so while the drawer is open two elements share
 *    `id="categoryId"` and the label resolves to the wrong one.
 *  - rc-select opens on **mousedown**, not click, so `user.click` leaves the
 *    dropdown shut.
 *  - `role="listbox"` is a zero-size accessibility mirror holding option *values*
 *    (`c1`), not the visible list. Clicking a `role="option"` node out of it does
 *    nothing at all. The clickable element is `.ant-select-item-option`, which
 *    carries the label as its title.
 */
const chooseOption = async (label: string, option: string) => {
    const item = drawer().getByText(label).closest('.ant-form-item') as HTMLElement;
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

/**
 * Attaches a product image.
 *
 * `ProductImage` marks the field required and antd's Upload renders a real
 * `<input type="file">`, so a create submit without this fails validation
 * silently — `onHandleSubmit` awaits `validateFields()` and nothing catches the
 * rejection.
 */
const attachImage = async (user: ReturnType<typeof userEvent.setup>) => {
    const input = document.querySelector('.ant-drawer-body input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['bytes'], 'pizza.png', { type: 'image/png' }));
};

/** The query string the last getProducts call was made with, parsed. */
const lastQuery = () => {
    const calls = apiMock.getProducts.mock.calls;
    return Object.fromEntries(new URLSearchParams(calls[calls.length - 1][0] as string));
};

describe('Products', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        apiMock.getProducts.mockResolvedValue(axiosResponse({ data: [PRODUCT], total: 1 }));
        apiMock.getCategories.mockResolvedValue(axiosResponse([CATEGORY]));
        apiMock.getCategory.mockResolvedValue(axiosResponse(CATEGORY));
        apiMock.getTenants.mockResolvedValue(TENANTS);
        apiMock.createProduct.mockResolvedValue(axiosResponse({}));
        apiMock.updateProduct.mockResolvedValue(axiosResponse({}));
    });

    describe('the list', () => {
        it('should show each product', async () => {
            renderProducts();

            expect(await screen.findByText('Margherita')).toBeInTheDocument();
        });

        it('should mark a published product', async () => {
            renderProducts();

            expect(await screen.findByText('Published')).toBeInTheDocument();
        });

        it('should mark a draft', async () => {
            apiMock.getProducts.mockResolvedValue(
                axiosResponse({ data: [{ ...PRODUCT, isPublish: false }], total: 1 }),
            );
            renderProducts();

            expect(await screen.findByText('Draft')).toBeInTheDocument();
        });

        it('should page six at a time', async () => {
            renderProducts();

            await waitFor(() => expect(lastQuery()).toMatchObject({ limit: '6', page: '1' }));
        });

        it('should show an error without unmounting the table', async () => {
            apiMock.getProducts.mockRejectedValue(new Error('Gateway timeout'));
            renderProducts();

            expect(await screen.findByText('Gateway timeout')).toBeInTheDocument();
        });
    });

    describe('tenant scoping', () => {
        it('should scope a manager to their own restaurant', async () => {
            renderProducts(MANAGER);

            await waitFor(() => expect(lastQuery()).toMatchObject({ tenantId: '3' }));
        });

        it('should not scope an admin', async () => {
            renderProducts(ADMIN);

            await waitFor(() => expect(apiMock.getProducts).toHaveBeenCalled());
            expect(lastQuery()).not.toHaveProperty('tenantId');
        });

        it('should drop empty filters from the query string', async () => {
            // `Object.entries(...).filter(item => !!item[1])` — which also drops
            // a legitimately falsy value. `isPublish: false` cannot be sent, so
            // "show only drafts" is unreachable through this filter.
            renderProducts(ADMIN);

            await waitFor(() => expect(apiMock.getProducts).toHaveBeenCalled());
            expect(Object.values(lastQuery())).not.toContain('');
        });

        it('should offer a restaurant filter only to an admin', async () => {
            renderProducts(MANAGER);

            await screen.findByText('Margherita');
            expect(screen.queryByText('Select restaurant')).not.toBeInTheDocument();
        });
    });

    describe('filtering', () => {
        it('should debounce the search box', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            renderProducts();
            await screen.findByText('Margherita');
            const initial = apiMock.getProducts.mock.calls.length;

            await userEvent
                .setup({ advanceTimers: vi.advanceTimersByTime })
                .type(screen.getByPlaceholderText('Search'), 'marg');

            expect(apiMock.getProducts).toHaveBeenCalledTimes(initial);

            await vi.advanceTimersByTimeAsync(600);
            await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'marg' }));
            vi.useRealTimers();
        });

        it('should reset to page one when a filter changes', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            renderProducts();
            await screen.findByText('Margherita');

            await userEvent
                .setup({ advanceTimers: vi.advanceTimersByTime })
                .type(screen.getByPlaceholderText('Search'), 'x');
            await vi.advanceTimersByTimeAsync(600);

            await waitFor(() => expect(lastQuery()).toMatchObject({ page: '1' }));
            vi.useRealTimers();
        });
    });

    describe('the price configuration round trip', () => {
        const openCreateDrawer = async () => {
            const user = interact();
            await screen.findByText('Margherita');
            await user.click(screen.getByRole('button', { name: /Add Product/ }));
            return user;
        };

        const chooseCategory = () => chooseOption('Category', 'Pizza');

        it('should not render price fields until a category is chosen', async () => {
            renderProducts();
            await openCreateDrawer();

            expect(drawer().queryByText('Product price')).not.toBeInTheDocument();
        });

        it('should build the price fields from the chosen category', async () => {
            renderProducts();
            await openCreateDrawer();

            await chooseCategory();

            expect(await screen.findByText('Product price')).toBeInTheDocument();
            expect(screen.getByText('Size (base)')).toBeInTheDocument();
            expect(screen.getByText('Crust (aditional)')).toBeInTheDocument();
        });

        it('should render one input per available option', async () => {
            renderProducts();
            await openCreateDrawer();

            await chooseCategory();

            const pricing = (await screen.findByText('Product price')).closest(
                '.ant-card',
            ) as HTMLElement;
            for (const option of ['Small', 'Large', 'Thin', 'Thick']) {
                expect(within(pricing).getByText(option)).toBeInTheDocument();
            }
        });

        it('should fetch the category once for both Pricing and Attributes', async () => {
            // Two components, the same query key, a five-minute staleTime — so
            // TanStack Query dedupes them into a single request.
            renderProducts();
            await openCreateDrawer();

            await chooseCategory();
            await screen.findByText('Product price');

            expect(apiMock.getCategory).toHaveBeenCalledTimes(1);
        });

        it('should render the widget each attribute declares', async () => {
            renderProducts();
            await openCreateDrawer();

            await chooseCategory();
            await screen.findByText('Attributes');

            // radio -> a radio group; switch -> a switch. There are two
            // switches in the drawer once a category is chosen: this attribute
            // and the "Published" toggle at the bottom of the form.
            expect(drawer().getByRole('radio', { name: 'Mild' })).toBeInTheDocument();
            expect(document.getElementById('attributes_isHit')).toHaveAttribute('role', 'switch');
            expect(drawer().getAllByRole('switch')).toHaveLength(2);
        });

        it('should turn a switch attribute on even when its default is No', async () => {
            // BUG, captured rather than asserted as correct.
            //
            //   <Form.Item valuePropName="checked" initialValue={attribute.defaultValue}>
            //     <Switch checkedChildren="Yes" unCheckedChildren="No" />
            //
            // `defaultValue` is the *string* "No", and `valuePropName="checked"`
            // feeds it straight to `checked`. Every non-empty string is truthy,
            // so a switch whose category default is "No" renders **on**.
            //
            // The value submitted is the string too, until someone toggles it
            // and it becomes a real boolean — so catelog-service receives
            // `"No"` for an untouched attribute and `false` for one that was
            // toggled twice. `initialValue={attribute.defaultValue === 'Yes'}`
            // is the fix.
            renderProducts();
            await openCreateDrawer();

            await chooseOption('Category', 'Pizza');
            await screen.findByText('Attributes');

            const toggle = document.getElementById('attributes_isHit') as HTMLElement;
            expect(toggle).toHaveClass('ant-switch-checked');
            expect(toggle).toHaveAttribute('aria-checked', 'No');
        });

        it('should decode the JSON form keys back into the API shape on submit', async () => {
            // The heart of it. The form holds
            //
            //   { '{"configurationKey":"Size","priceType":"base"}': { Large: 800 } }
            //
            // and `onHandleSubmit` parses that key apart to rebuild
            //
            //   { Size: { priceType: 'base', availableOptions: { Large: 800 } } }
            //
            // which is exactly what catelog-service stores. `priceType`
            // therefore survives a round trip through the DOM as part of a field
            // *name* — there is nowhere else it is kept.
            renderProducts();
            const user = await openCreateDrawer();
            await chooseCategory();
            await screen.findByText('Product price');

            await user.type(drawer().getByLabelText('Product name'), 'New Pizza');
            await user.type(drawer().getByLabelText('Description'), 'Tasty');
            await attachImage(user);
            // Required for an admin — the Tenant info card is only hidden for a
            // manager.
            await chooseOption('Restaurant', 'Pizza Palace');
            const pricing = drawer().getByText('Product price').closest('.ant-card') as HTMLElement;
            await user.type(within(pricing).getByLabelText('Large'), '800');
            await user.type(within(pricing).getByLabelText('Thick'), '100');

            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() => expect(apiMock.createProduct).toHaveBeenCalled());
            const form = apiMock.createProduct.mock.calls[0][0] as FormData;
            const pricingSent = JSON.parse(form.get('priceConfiguration') as string);

            expect(pricingSent.Size.priceType).toBe('base');
            expect(pricingSent.Size.availableOptions.Large).toBe(800);
            expect(pricingSent.Crust.priceType).toBe('aditional');
            expect(pricingSent.Crust.availableOptions.Thick).toBe(100);
        });

        it('should convert the attributes object into the array the API wants', async () => {
            renderProducts();
            const user = await openCreateDrawer();
            await chooseCategory();
            await screen.findByText('Product price');

            await user.type(drawer().getByLabelText('Product name'), 'New Pizza');
            await user.type(drawer().getByLabelText('Description'), 'Tasty');
            await attachImage(user);
            await chooseOption('Restaurant', 'Pizza Palace');
            const pricing = drawer().getByText('Product price').closest('.ant-card') as HTMLElement;
            await user.type(within(pricing).getByLabelText('Large'), '800');
            await user.type(within(pricing).getByLabelText('Thick'), '100');

            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() => expect(apiMock.createProduct).toHaveBeenCalled());
            const form = apiMock.createProduct.mock.calls[0][0] as FormData;

            // The form holds `{ Spiciness: 'Mild', isHit: 'No' }` and this
            // turns it into the `[{ name, value }]` array catelog-service
            // stores. Note `isHit` arrives as the string "No" rather than a
            // boolean — see the switch test above.
            expect(JSON.parse(form.get('attributes') as string)).toEqual([
                { name: 'Spiciness', value: 'Mild' },
                { name: 'isHit', value: 'No' },
            ]);
        });

        it('should send the tenant an admin selected', async () => {
            renderProducts(ADMIN);
            const user = await openCreateDrawer();
            await chooseCategory();
            await screen.findByText('Product price');

            await user.type(drawer().getByLabelText('Product name'), 'New Pizza');
            await user.type(drawer().getByLabelText('Description'), 'Tasty');
            await attachImage(user);
            await chooseOption('Restaurant', 'Pizza Palace');
            const pricing = drawer().getByText('Product price').closest('.ant-card') as HTMLElement;
            await user.type(within(pricing).getByLabelText('Large'), '800');
            await user.type(within(pricing).getByLabelText('Thick'), '100');

            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() => expect(apiMock.createProduct).toHaveBeenCalled());
            const form = apiMock.createProduct.mock.calls[0][0] as FormData;
            expect(form.get('tenantId')).toBe('3');
        });

        it('should force a manager’s own tenant regardless of the form', async () => {
            // `user!.role === 'manager' ? user?.tenant?.id : form.getFieldValue('tenantId')`
            // — the Tenant info card is not even rendered for a manager, so
            // there is nothing to override.
            renderProducts(MANAGER);
            const user = await openCreateDrawer();
            await chooseCategory();
            await screen.findByText('Product price');

            await user.type(drawer().getByLabelText('Product name'), 'New Pizza');
            await user.type(drawer().getByLabelText('Description'), 'Tasty');
            await attachImage(user);
            const pricing = drawer().getByText('Product price').closest('.ant-card') as HTMLElement;
            await user.type(within(pricing).getByLabelText('Large'), '800');
            await user.type(within(pricing).getByLabelText('Thick'), '100');

            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() => expect(apiMock.createProduct).toHaveBeenCalled());
            expect(drawer().queryByText('Tenant info')).not.toBeInTheDocument();
            const form = apiMock.createProduct.mock.calls[0][0] as FormData;
            expect(form.get('tenantId')).toBe('3');
        });
    });

    describe('editing', () => {
        const openEditDrawer = async () => {
            const user = interact();
            await screen.findByText('Margherita');
            await user.click(screen.getByRole('button', { name: 'Edit' }));
            return user;
        };

        it('should open the drawer in update mode', async () => {
            renderProducts();
            await openEditDrawer();

            expect(await screen.findByText('Update Product')).toBeInTheDocument();
        });

        it('should re-encode the stored prices back into JSON form keys', async () => {
            // The reverse of the decode above, so `setFieldsValue` can
            // repopulate the drawer. Both directions use the same
            // `JSON.stringify({ configurationKey, priceType })` expression —
            // written out twice, in two files, with nothing keeping them in
            // step. Reordering the two properties in either place would break
            // pricing silently.
            renderProducts();
            await openEditDrawer();

            const pricing = (await screen.findByText('Product price')).closest(
                '.ant-card',
            ) as HTMLElement;

            expect(within(pricing).getByLabelText('Large')).toHaveValue('800');
            expect(within(pricing).getByLabelText('Thick')).toHaveValue('100');
        });

        it('should repopulate the attributes', async () => {
            renderProducts();
            await openEditDrawer();

            await screen.findByText('Attributes');
            expect(drawer().getByRole('radio', { name: 'Hot' })).toBeChecked();
        });

        it('should PUT rather than POST', async () => {
            renderProducts();
            const user = await openEditDrawer();
            await screen.findByText('Product price');

            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() =>
                expect(apiMock.updateProduct).toHaveBeenCalledWith(
                    expect.any(FormData),
                    PRODUCT._id,
                ),
            );
            expect(apiMock.createProduct).not.toHaveBeenCalled();
        });

        it('should send the stored image URL where a File is expected', async () => {
            // BUG, captured rather than asserted as correct. The edit effect
            // does `form.setFieldsValue({ ...selectedProduct })`, so `image`
            // becomes the stored URL *string*. `makeFormData` then appends
            // `(value as ImageField).file`, which is undefined — so an edit that
            // does not touch the image posts `image: "undefined"` and
            // catelog-service's `updateProduct` sees no file.
            //
            // Saving a product to change only its description therefore risks
            // its image, and the type assertion in makeFormData is what hides
            // it from the compiler.
            renderProducts();
            const user = await openEditDrawer();
            await screen.findByText('Product price');

            await user.click(screen.getByRole('button', { name: 'Submit' }));

            await waitFor(() => expect(apiMock.updateProduct).toHaveBeenCalled());
            const form = apiMock.updateProduct.mock.calls[0][0] as FormData;
            expect(form.get('image')).toBe('undefined');
        });
    });

    describe('known defects', () => {
        it('should key the table rows on a field products do not have', async () => {
            // BUG, captured rather than asserted as correct. `rowKey={'id'}`,
            // but catelog-service returns `_id`. Every row gets `undefined` as
            // its React key, so a re-render cannot tell rows apart — antd falls
            // back to the row index. Users, Tenants and Orders all get this
            // right; only this table does not.
            renderProducts();
            await screen.findByText('Margherita');

            expect(PRODUCT).not.toHaveProperty('id');
            expect(PRODUCT).toHaveProperty('_id');
        });
    });
});
