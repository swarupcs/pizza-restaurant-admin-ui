import { describe, expect, it } from 'vitest';
import { capitalizeFirst, makeFormData } from './helpers';
import type { CreateProductData } from '../../types';

/**
 * `makeFormData` is the last step before a product is posted. The endpoint is
 * `multipart/form-data` because a product carries an image, and FormData values
 * are strings — so the two structured fields have to be serialised by hand, and
 * catelog-service's validators expect exactly that shape back.
 */

const productData = (overrides: Record<string, unknown> = {}) =>
    ({
        name: 'Margherita',
        description: 'Classic',
        categoryId: '670000000000000000000009',
        tenantId: '3',
        isPublish: true,
        image: { file: new File(['bytes'], 'pizza.png', { type: 'image/png' }) },
        priceConfiguration: {
            Size: { priceType: 'base', availableOptions: { Small: 400, Large: 800 } },
        },
        attributes: [{ name: 'Spiciness', value: 'Hot' }],
        ...overrides,
    }) as unknown as CreateProductData;

describe('makeFormData', () => {
    it('should return a FormData', () => {
        expect(makeFormData(productData())).toBeInstanceOf(FormData);
    });

    it('should append the raw File under image', () => {
        // antd's Upload wraps the file as `{ file }`; the endpoint wants the
        // File itself.
        const form = makeFormData(productData());

        const image = form.get('image');
        expect(image).toBeInstanceOf(File);
        expect((image as File).name).toBe('pizza.png');
    });

    it('should serialise priceConfiguration as JSON', () => {
        const form = makeFormData(productData());

        expect(JSON.parse(form.get('priceConfiguration') as string)).toEqual({
            Size: { priceType: 'base', availableOptions: { Small: 400, Large: 800 } },
        });
    });

    it('should serialise attributes as JSON', () => {
        const form = makeFormData(productData());

        expect(JSON.parse(form.get('attributes') as string)).toEqual([
            { name: 'Spiciness', value: 'Hot' },
        ]);
    });

    it('should pass scalars through as strings', () => {
        const form = makeFormData(productData());

        expect(form.get('name')).toBe('Margherita');
        expect(form.get('categoryId')).toBe('670000000000000000000009');
    });

    it('should stringify a boolean', () => {
        // FormData coerces, so `isPublish` arrives at catelog-service as the
        // string "true" — which is why its validator treats it as a string
        // rather than a boolean.
        const form = makeFormData(productData({ isPublish: true }));

        expect(form.get('isPublish')).toBe('true');
    });

    it('should stringify false rather than dropping it', () => {
        const form = makeFormData(productData({ isPublish: false }));

        expect(form.get('isPublish')).toBe('false');
    });

    it('should send every key it is given', () => {
        // There is no allow-list: whatever the antd form holds is posted,
        // including fields the endpoint does not know about.
        const form = makeFormData(productData({ somethingElse: 'leaks through' }));

        expect(form.get('somethingElse')).toBe('leaks through');
    });

    it('should send the literal string "undefined" for a missing tenant', () => {
        // BUG-adjacent, captured rather than asserted as correct. A manager's
        // `tenantId` comes from `user?.tenant?.id`, and an optional chain that
        // misses yields `undefined` — which FormData turns into the *string*
        // "undefined" rather than omitting the field. catelog-service then
        // stores a product under a tenant id of "undefined" rather than
        // rejecting it.
        const form = makeFormData(productData({ tenantId: undefined }));

        expect(form.get('tenantId')).toBe('undefined');
    });

    it('should throw when there is no image', () => {
        // ProductImage marks the field required, so the form validates first —
        // but on the edit path the initial value is a URL string rather than
        // `{ file }`, and `(value as ImageField).file` is then undefined.
        expect(() => makeFormData(productData({ image: undefined }))).toThrow();
    });
});

describe('capitalizeFirst', () => {
    it('should capitalise the first letter', () => {
        expect(capitalizeFirst('received')).toBe('Received');
    });

    it('should leave the rest alone', () => {
        // Which is why an order status renders as "Out_for_delivery" rather
        // than "Out for delivery" — the underscores are never touched.
        expect(capitalizeFirst('out_for_delivery')).toBe('Out_for_delivery');
    });

    it('should be a no-op for an already-capitalised string', () => {
        expect(capitalizeFirst('Paid')).toBe('Paid');
    });

    it('should handle a single character', () => {
        expect(capitalizeFirst('a')).toBe('A');
    });

    it('should throw on an empty string', () => {
        // BUG, captured rather than asserted as correct. `str[0].toUpperCase()`
        // reads `.toUpperCase` off undefined. Both callers pass an order status
        // straight from the API, so an order saved without one — order-service
        // does not require `orderStatus`, and `findOneAndUpdate` skips enum
        // validation — takes the whole orders table down with it.
        expect(() => capitalizeFirst('')).toThrow();
    });

    it('should throw on undefined', () => {
        expect(() => capitalizeFirst(undefined as unknown as string)).toThrow();
    });
});
