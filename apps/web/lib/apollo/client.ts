'use client';

import { ApolloClient, HttpLink, InMemoryCache, split } from '@apollo/client';
import { SetContextLink } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient, type Client as WsClient } from 'graphql-ws';
import type { WsStatus } from './ws-status';

/**
 * FE-0 QĐ-B/1a — Apollo Client cho apps/web.
 *
 * Nguyên tắc chốt:
 *   1. Client-only. Toàn bộ được khởi tạo trong Client Component (module này có
 *      "use client" ở đầu, và {@link ApolloProviderWithSession} cũng vậy). Đây
 *      là cách né vùng rủi ro RSC ↔ Apollo — 20/22 màn đều cần tương tác nên
 *      RSC không mua được gì đáng kể (xem PLAN_FRONTEND.md §1 QĐ-B ghi chú).
 *   2. Cùng một token gắn cho CẢ HTTP và WebSocket. Backend đóng WS ngay
 *      handshake bằng mã 4403 nếu token sai/thiếu (auth/ws-auth.ts:81-91).
 *   3. Cursor coi là chuỗi mờ — normalized cache không cần typePolicies riêng
 *      cho pagination ở FE-0. Hook cuộn vô hạn (FE-0/6) tự merge edges bằng
 *      fetchMore + updateQuery.
 *   4. Bẫy #1 (viewer-aware field im lặng): nếu Authorization thiếu, backend
 *      trả `isSavedByViewer=false`/`viewerReaction=null` KHÔNG lỗi. Vì thế
 *      authLink phải luôn chạy — kể cả khi token null, chỉ là không gắn header.
 *      Phép kiểm chuẩn: hai nhánh khác nhau trong CÙNG một response.
 */

export interface AccessTokenSource {
  /** Trả về token hiện tại (hoặc null nếu chưa login). Có thể là snapshot đồng bộ. */
  getAccessToken: () => string | null | Promise<string | null>;
  /** FE-8 — báo trạng thái socket cho UI (banner "Đang kết nối lại…" ở D2). */
  onWsStatus?: (status: WsStatus) => void;
}

/**
 * FE-8 — trả về CẢ ApolloClient lẫn graphql-ws client. Provider cần tay cầm
 * `wsClient` để `terminate()` ép nối lại khi access token xoay (điểm mù FE-0):
 * socket bắt tay MỘT LẦN bằng token cũ, backend đóng 4403 khi token hết hạn;
 * terminate() → graphql-ws thử lại → bắt tay lại, `connectionParams` đọc token
 * mới nhất từ ref. `wsClient` là null khi prerender trên server (không có window).
 */
export interface ApolloBundle {
  client: ApolloClient;
  wsClient: WsClient | null;
}

const GRAPHQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'http://localhost:4000/graphql';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/graphql';

export function createApolloClient(source: AccessTokenSource): ApolloBundle {
  const httpLink = new HttpLink({
    uri: GRAPHQL_URL,
    // credentials: 'omit' — backend chỉ chấp Bearer, không dựa cookie.
    credentials: 'omit',
  });

  // Apollo v4 signature: (prevContext, operation) => Partial<Context>.
  // Legacy v3 signature (operation, prevContext) đã đảo.
  const authLink = new SetContextLink(async (prevContext) => {
    const token = await source.getAccessToken();
    const prevHeaders = (prevContext.headers ?? {}) as Record<string, string>;
    return {
      headers: token ? { ...prevHeaders, Authorization: `Bearer ${token}` } : prevHeaders,
    };
  });

  // WebSocket client chỉ được tạo bên client. Trong Next 16, Client Component vẫn
  // có thể prerender 1 lần trên server nên phải guard bằng typeof window.
  const wsClient =
    typeof window === 'undefined'
      ? null
      : createClient({
          url: WS_URL,
          // `lazy` (mặc định true) ⇒ chỉ mở socket khi có subscription; đóng khi
          // hết subscription. Vì thế khách chưa đăng nhập không tốn kết nối.
          connectionParams: async () => {
            const token = await source.getAccessToken();
            // Gọi TẠI MỖI LẦN bắt tay (kể cả lần nối lại) ⇒ luôn lấy token mới
            // nhất từ ref. Đây là điều làm cho terminate()-để-nối-lại lấy đúng
            // token đã xoay.
            return token ? { authorization: `Bearer ${token}` } : {};
          },
          // Nối lại khi rụng vì mạng (đóng bất thường). Token hết hạn (4403) là
          // "chí mạng" ⇒ graphql-ws không tự thử lại; đường phục hồi là provider
          // gọi terminate() khi token xoay + subscriber remount khi lỗi.
          shouldRetry: () => true,
          retryAttempts: Infinity,
          retryWait: (retries) =>
            new Promise((resolve) =>
              setTimeout(resolve, Math.min(1000 * 2 ** retries, 10_000)),
            ),
          on: {
            connecting: () => source.onWsStatus?.('connecting'),
            connected: () => source.onWsStatus?.('connected'),
            closed: () => source.onWsStatus?.('closed'),
            error: () => source.onWsStatus?.('closed'),
          },
        });

  const wsLink = wsClient ? new GraphQLWsLink(wsClient) : null;

  const link = wsLink
    ? split(
        ({ query }) => {
          const def = getMainDefinition(query);
          return def.kind === 'OperationDefinition' && def.operation === 'subscription';
        },
        wsLink,
        authLink.concat(httpLink),
      )
    : authLink.concat(httpLink);

  const client = new ApolloClient({
    link,
    cache: new InMemoryCache(),
    devtools: { enabled: process.env.NODE_ENV !== 'production' },
  });

  return { client, wsClient };
}
