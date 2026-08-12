'use client';

import { ApolloClient, HttpLink, InMemoryCache, split } from '@apollo/client';
import { SetContextLink } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';

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
}

const GRAPHQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'http://localhost:4000/graphql';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/graphql';

export function createApolloClient(source: AccessTokenSource): ApolloClient {
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

  // WebSocket link chỉ được tạo bên client. Trong Next 16, Client Component vẫn
  // có thể prerender 1 lần trên server nên phải guard bằng typeof window.
  const wsLink =
    typeof window === 'undefined'
      ? null
      : new GraphQLWsLink(
          createClient({
            url: WS_URL,
            connectionParams: async () => {
              const token = await source.getAccessToken();
              // graphql-ws gọi hàm này TẠI HANDSHAKE, không refresh khi token
              // đổi. Nếu backend đóng 4403, hook subscription sẽ nhận connect
              // error — logic reconnect nằm ở tầng UI (FE-8/FE-9), không ở đây.
              return token ? { authorization: `Bearer ${token}` } : {};
            },
            shouldRetry: () => false,
          }),
        );

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

  return new ApolloClient({
    link,
    cache: new InMemoryCache(),
    devtools: { enabled: process.env.NODE_ENV !== 'production' },
  });
}
