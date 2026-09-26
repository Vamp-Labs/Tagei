import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './errors';

const NON_RETRYABLE = new Set(['VALIDATION', 'SESSION_REQUIRED', 'BAD_SIGNATURE', 'ROUND_NOT_FOUND', 'API_DISABLED', 'BAD_RESPONSE']);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => failureCount < 2 && !(isApiError(error) && NON_RETRYABLE.has(error.code)),
    },
    mutations: { retry: false },
  },
});
