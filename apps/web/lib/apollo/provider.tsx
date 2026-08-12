'use client';

import { useMemo, useRef } from 'react';
import { ApolloProvider } from '@apollo/client/react';
import { useSession } from 'next-auth/react';
import { createApolloClient } from './client';

/**
 * Cầu nối Auth.js session → Apollo Client.
 *
 * Vì sao ref chứ không phải re-create client mỗi lần session đổi:
 *   - createApolloClient() dựng cả HTTP link + WebSocket. Re-tạo mỗi lần session
 *     thay đổi ⇒ WS bị đóng và mở lại ⇒ mất subscription hiện có + cache reset.
 *   - Snapshot token vào ref: authLink đọc ref TẠI THỜI ĐIỂM request — luôn
 *     lấy token mới nhất mà không cần rebuild client.
 *
 * Điểm mù đã biết (chấp nhận ở FE-0, xử lý ở FE-8/FE-9):
 *   - graphql-ws chỉ gọi connectionParams TẠI HANDSHAKE. Nếu token refresh giữa
 *     phiên WS đang mở, socket dùng token cũ; backend đóng 4403 khi token cũ
 *     hết hạn. Fix đúng: force reconnect socket khi session.error === 'RefreshAccessTokenError'.
 */
export function ApolloProviderWithSession({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = session?.accessToken ?? null;

  const client = useMemo(
    () =>
      createApolloClient({
        getAccessToken: () => tokenRef.current,
      }),
    // KHÔNG phụ thuộc session — client giữ ổn định qua ref.
    [],
  );

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
