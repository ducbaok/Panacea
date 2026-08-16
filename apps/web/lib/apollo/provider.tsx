'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ApolloProvider } from '@apollo/client/react';
import { useSession } from 'next-auth/react';
import { createApolloClient, type ApolloBundle } from './client';
import { WsStatusContext, type WsStatus } from './ws-status';

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
 *     hết hạn.
 *
 * FE-8 xử lý điểm mù này ở tầng kết nối (đúng như brief §3 dặn):
 *   - Xoay token THÀNH CÔNG (session.accessToken đổi giá trị, KHÔNG có
 *     session.error): gọi `wsClient.terminate()` để ép bắt tay lại NGAY với token
 *     mới, không đợi backend đóng 4403. graphql-ws thử lại (shouldRetry) và
 *     connectionParams đọc token mới từ ref.
 *   - Xoay token THẤT BẠI (session.error === 'RefreshAccessTokenError'): đã có
 *     `SessionErrorGuard` gọi signOut() → socket đóng tự nhiên vì mất token.
 */
export function ApolloProviderWithSession({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  const token = session?.accessToken ?? null;
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  const [wsStatus, setWsStatus] = useState<WsStatus>('idle');
  const bundleRef = useRef<ApolloBundle | null>(null);

  const client = useMemo(() => {
    const bundle = createApolloClient({
      getAccessToken: () => tokenRef.current,
      onWsStatus: setWsStatus,
    });
    bundleRef.current = bundle;
    return bundle.client;
    // KHÔNG phụ thuộc session — client giữ ổn định qua ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ép socket nối lại khi access token XOAY (đổi giá trị trong lúc vẫn đăng
  // nhập). Khách→đăng nhập / đăng nhập→khách để `resetStore` dưới lo (socket tự
  // mở/đóng theo subscription). CHỈ terminate khi cả prev lẫn token đều non-null
  // và khác nhau — tránh terminate vô cớ lúc đăng nhập/đăng xuất.
  const prevTokenRef = useRef<string | null>(token);
  useEffect(() => {
    const prev = prevTokenRef.current;
    prevTokenRef.current = token;
    if (prev !== null && token !== null && prev !== token) {
      bundleRef.current?.wsClient?.terminate();
    }
  }, [token]);

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

  return (
    <ApolloProvider client={client}>
      <WsStatusContext.Provider value={wsStatus}>{children}</WsStatusContext.Provider>
    </ApolloProvider>
  );
}
