'use client';

import { useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';

/**
 * FE-5 §6.4 — nối `session.error` → `signOut()`.
 *
 * `auth.ts` (callback jwt/session) đẩy `RefreshAccessTokenError` / `ExchangeError`
 * ra `session.error` khi chuỗi làm mới token đứt, kèm chú thích "Apollo link sẽ
 * signOut()". Nhưng trước FE-5 KHÔNG có chỗ nào thực sự gọi `signOut` (0 hit).
 * Đây là chỗ nối: thấy error ⇒ đăng xuất sạch rồi đưa về /login.
 *
 * Vì sao ở đây chứ không trong Apollo link: Apollo link chạy theo từng request
 * GraphQL, không thấy được phiên khi user chỉ đang xem trang tĩnh. Một guard cấp
 * cao nghe `useSession()` bắt được error ngay cả khi chưa có query nào chạy — ví
 * dụ khi đổi mật khẩu ở thiết bị khác thu hồi refresh token (hướng C §6.5).
 */
export function SessionErrorGuard() {
  const { data: session } = useSession();
  const error = session?.error;

  useEffect(() => {
    if (error === 'RefreshAccessTokenError' || error === 'ExchangeError') {
      void signOut({ redirectTo: '/login' });
    }
  }, [error]);

  return null;
}
