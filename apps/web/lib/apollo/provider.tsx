'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  FE-9 — LỖ HỔNG CÒN LẠI CỦA TẦNG FE-8, BẮT ĐƯỢC BẰNG PHÉP "TREO TAB"     ║
 * ║                                                                          ║
 * ║  Đo được 17/08/2026 trên trình duyệt thật: mở /messages rồi để tab NGỒI   ║
 * ║  YÊN 18 phút, sau đó người kia gửi tin ⇒ **tin KHÔNG BAO GIỜ tới**, banner║
 * ║  "Đang kết nối lại…" bật lúc 07:44:24 và kẹt ở đó vô hạn.                ║
 * ║                                                                          ║
 * ║  NGUYÊN NHÂN GỐC — cơ chế FE-8 đúng nhưng THIẾU một nhánh:               ║
 * ║    1. Access token sống 900s. Socket bắt tay lúc t0 bằng token hết hạn    ║
 * ║       tại t0+900.                                                        ║
 * ║    2. Tab ngồi yên ⇒ `useSession()` KHÔNG tự nạp lại (không có            ║
 * ║       refetchInterval) ⇒ `tokenRef.current` đứng yên ở token ĐÃ CHẾT.    ║
 * ║    3. Backend đóng socket. `shouldRetry:()=>true` + `retryAttempts:       ║
 * ║       Infinity` thử lại — nhưng `connectionParams` lại đọc ĐÚNG cái token ║
 * ║       đã chết đó ⇒ 4403 ⇒ thử lại ⇒ 4403… vòng lặp không lối ra.        ║
 * ║    4. `terminate()` ở dưới chỉ chạy khi token ĐỔI GIÁ TRỊ. Token không    ║
 * ║       bao giờ đổi vì session không bao giờ được nạp lại. Nhánh cứu hộ     ║
 * ║       của FE-8 nằm im đúng lúc cần nó nhất.                              ║
 * ║                                                                          ║
 * ║  ⇒ Thử lại mãi bằng một chứng chỉ đã chết thì không phải "nối lại", mà   ║
 * ║  là gõ cửa bằng chìa hỏng. Chỗ sửa đúng là NGUỒN TOKEN, không phải tầng   ║
 * ║  thử lại: `getAccessToken` tự đi lấy token mới khi cái đang giữ đã hết    ║
 * ║  hạn. `connectionParams` được gọi ở MỖI lần bắt tay lại ⇒ lần thử kế      ║
 * ║  tiếp mang token còn sống và vòng lặp tự mở.                             ║
 * ║                                                                          ║
 * ║  Vì sao KHÔNG chọn `refetchInterval` của SessionProvider: nó chỉ thu hẹp  ║
 * ║  cửa sổ hỏng (vẫn kẹt trong khoảng giữa hai lần poll) và bắt MỌI tab poll ║
 * ║  mãi mãi dù có dùng WS hay không. Sửa ở nguồn token thì đúng lúc, đúng    ║
 * ║  chỗ, và không tốn request nào khi token còn hạn.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/** Còn dưới ngần này giây thì coi như đã hết hạn — trừ hao lệch giờ + đường truyền. */
const TOKEN_SKEW_SEC = 30;

/** `exp` (giây) của JWT, hoặc null nếu không đọc được. KHÔNG xác thực chữ ký — chỉ đọc hạn. */
function readExp(jwt: string): number | null {
  try {
    const [, payload] = jwt.split('.');
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

function isUsable(jwt: string | null): jwt is string {
  if (!jwt) return false;
  const exp = readExp(jwt);
  // Không đọc được `exp` ⇒ cứ dùng; để backend phán, đừng tự vứt token có thể còn tốt.
  return exp === null || exp * 1000 - TOKEN_SKEW_SEC * 1000 > Date.now();
}

export function ApolloProviderWithSession({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  const token = session?.accessToken ?? null;
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  /**
   * Token do CHÍNH `getAccessToken` nạp về khi ảnh chụp session đã hết hạn.
   *
   * Vì sao phải là ref THỨ HAI chứ không ghi đè `tokenRef`: `tokenRef` được gán
   * lại ở MỌI lượt render từ `session` — một tab ngồi yên thì giá trị đó là ảnh
   * chụp cũ, nên ghi token mới vào đấy sẽ bị lượt render kế xoá sạch. Tách ra
   * hai ref cũng giữ cho thân render chỉ GHI ref chứ không ĐỌC (luật
   * `react-hooks/refs`) — mọi lần đọc nằm trong callback, tức ngoài render.
   */
  const freshTokenRef = useRef<string | null>(null);

  const [wsStatus, setWsStatus] = useState<WsStatus>('idle');
  const bundleRef = useRef<ApolloBundle | null>(null);

  /**
   * Token còn hạn ⇒ trả ngay từ ref (0 request). Hết hạn ⇒ hỏi thẳng
   * `/api/auth/session`; route đó chạy callback `jwt` của Auth.js nên nó tự làm
   * vòng refresh và trả về access token MỚI.
   *
   * `inFlightRef` gộp các lời gọi chồng nhau: lúc socket đang thử lại, cả
   * authLink (HTTP) lẫn connectionParams (WS) có thể cùng hỏi một lúc — không
   * gộp thì mỗi lần thử lại đẻ thêm một request refresh.
   */
  const inFlightRef = useRef<Promise<string | null> | null>(null);
  // `useCallback([])` chứ không phải `useRef(fn).current`: đọc `.current` ngay
  // trong thân render là vi phạm `react-hooks/refs`. Thân callback chạy SAU
  // render nên đọc ref bên trong nó là hợp lệ.
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    // Ảnh chụp session còn hạn ⇒ nó là nguồn đúng; vứt bản tự nạp cho khỏi lệch.
    if (isUsable(tokenRef.current)) {
      freshTokenRef.current = null;
      return tokenRef.current;
    }
    // Bản tự nạp lần trước vẫn còn hạn ⇒ dùng lại, không gọi mạng nữa.
    if (isUsable(freshTokenRef.current)) return freshTokenRef.current;
    // Chưa đăng nhập thì không có gì để làm mới — đừng gọi mạng vô ích.
    if (tokenRef.current === null) return null;
    if (!inFlightRef.current) {
      inFlightRef.current = (async () => {
        try {
          const res = await fetch('/api/auth/session');
          const data = (await res.json()) as { accessToken?: string } | null;
          const fresh = data?.accessToken ?? null;
          if (fresh) freshTokenRef.current = fresh;
          return fresh;
        } catch {
          // Mạng hỏng: trả token cũ để tầng thử-lại cứ thử tiếp; lần sau đỡ hơn.
          return tokenRef.current;
        } finally {
          inFlightRef.current = null;
        }
      })();
    }
    return inFlightRef.current;
  }, []);

  const client = useMemo(() => {
    const bundle = createApolloClient({
      getAccessToken,
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
