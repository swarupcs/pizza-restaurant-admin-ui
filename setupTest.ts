import '@testing-library/jest-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useAuthStore } from './src/store';

/**
 * antd reaches for browser APIs jsdom does not implement, at render time rather
 * than on interaction — so without these every antd component throws on mount
 * and the failure looks nothing like the assertion that provoked it.
 */
beforeEach(() => {
    const matchMediaMock = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // Deprecated
        removeListener: vi.fn(), // Deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
    const computedStyleMock = vi.fn().mockImplementation(() => ({}));
    vi.stubGlobal('matchMedia', matchMediaMock);
    vi.stubGlobal('computedStyle', computedStyleMock);

    // A real class, not `vi.fn().mockImplementation(...)`: rc-* components call
    // `new ResizeObserver(...)`, and a mock function is not a constructor.
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );

    // antd's Table and Select scroll their active row/option into view.
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    cleanup();
    // The auth store is a module-level zustand singleton, so it survives
    // between tests in a file. Leaving a logged-in admin behind would let a
    // later test pass for the wrong reason.
    useAuthStore.setState({ user: null });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
