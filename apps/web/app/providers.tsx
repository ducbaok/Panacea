'use client';

import { SessionProvider } from 'next-auth/react';
import { ApolloProviderWithSession } from '@/lib/apollo/provider';
import { SessionErrorGuard } from '@/components/auth/session-error-guard';
import { AuthPromptProvider } from '@/components/auth/auth-prompt';
import { ToastProvider } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { BoardPickerProvider } from '@/components/board/board-picker';
import { NotificationSubscriber } from '@/components/shell/notification-subscriber';
import { LocaleProvider } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n/config';

/**
 * Composed provider tree cho apps/web.
 *
 * Thứ tự KHÔNG đảo:
 *   SessionProvider  → cung cấp useSession() cho Apollo
 *     └─ ApolloProvider  → cung cấp useQuery/useMutation cho toàn app
 *
 * Đảo lại thì Apollo không đọc được session, tất cả field viewer-aware về
 * `false`/`null` im lặng (bẫy #1 ở PLAN_FRONTEND.md §4).
 *
 * `LocaleProvider` bọc NGOÀI CÙNG: ToastProvider, ConfirmProvider,
 * AuthPromptProvider và BoardPickerProvider đều tự dựng chữ của chúng, nên
 * phải nằm TRONG cây locale mới gọi được useT(). `initialLocale` do
 * app/layout.tsx đọc cookie ở server truyền xuống.
 */
export function Providers({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale: Locale;
}) {
  return (
    <LocaleProvider initialLocale={initialLocale}>
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
    </LocaleProvider>
  );
}
