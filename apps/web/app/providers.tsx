'use client';

import { SessionProvider } from 'next-auth/react';
import { ApolloProviderWithSession } from '@/lib/apollo/provider';
import { SessionErrorGuard } from '@/components/auth/session-error-guard';
import { AuthPromptProvider } from '@/components/auth/auth-prompt';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { BoardPickerProvider } from '@/components/board/board-picker';
import { NotificationSubscriber } from '@/components/shell/notification-subscriber';

/**
 * Composed provider tree cho apps/web.
 *
 * Thứ tự KHÔNG đảo:
 *   SessionProvider  → cung cấp useSession() cho Apollo
 *     └─ ApolloProvider  → cung cấp useQuery/useMutation cho toàn app
 *
 * Đảo lại thì Apollo không đọc được session, tất cả field viewer-aware về
 * `false`/`null` im lặng (bẫy #1 ở PLAN_FRONTEND.md §4).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SessionErrorGuard />
      <ApolloProviderWithSession>
        <NotificationSubscriber />
        <ToastProvider>
          <ConfirmProvider>
            <AuthPromptProvider>
              <BoardPickerProvider>{children}</BoardPickerProvider>
            </AuthPromptProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ApolloProviderWithSession>
    </SessionProvider>
  );
}
