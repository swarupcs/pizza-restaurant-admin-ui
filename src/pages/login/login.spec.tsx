import { it, describe, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './login';

// LoginPage calls useQuery for the /auth/self lookup, so it needs a client in
// context. A fresh client per render keeps tests isolated; retry is off so a
// failed query surfaces immediately instead of being retried in the background.
const renderLoginPage = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <LoginPage />
        </QueryClientProvider>
    );
};

describe('Login page', () => {
    it('should render with required fields', () => {
        renderLoginPage();
        // getBy -> throws an error
        // queryBy -> null
        // findBy -> Async
        expect(screen.getByText('Sign in')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeInTheDocument();
        expect(screen.getByText('Forgot password')).toBeInTheDocument();
    });
});
