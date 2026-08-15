'use client';

import { useEffect, useMemo, useRef } from 'react';
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

  const token = session?.accessToken ?? null;
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  const client = useMemo(
    () =>
      createApolloClient({
        getAccessToken: () => tokenRef.current,
      }),
    // KHÔNG phụ thuộc session — client giữ ổn định qua ref.
    [],
  );

  // FE-5: refetch khi CHUYỂN TRẠNG THÁI đăng nhập (khách→đăng nhập / đăng
  // nhập→khách). Query của feed thường bắn TRƯỚC khi useSession kịp nạp token
  // ⇒ nhận dữ liệu khách (isSavedByViewer=false) rồi cache, không tự chạy lại
  // khi token về. `resetStore` chạy lại mọi active query với token mới nên
  // pin đã lưu hiện đúng "Đã lưu" ngay sau đăng nhập, và về false sau đăng xuất.
  //
  // ⚠️ CHỈ kích hoạt khi cờ đăng-nhập ĐẢO, KHÔNG phải mỗi lần token đổi giá trị:
  // access token xoay ~15 phút một lần (callback jwt), reset mỗi lần xoay sẽ nạp
  // lại toàn feed + reset phân trang vô cớ. Token mới sau khi xoay được authLink
  // đọc từ ref ở request kế tiếp, không cần reset.
  const wasAuthedRef = useRef<boolean>(token !== null);
  useEffect(() => {
    const isAuthed = token !== null;
    if (wasAuthedRef.current !== isAuthed) {
      wasAuthedRef.current = isAuthed;
      void client.resetStore().catch(() => {
        // resetStore reject khi có query lỗi (vd [T] me của khách → Unauthorized)
        // — không sao, chỉ là refetch, nuốt để không nổi unhandled rejection.
      });
    }
  }, [token, client]);

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
