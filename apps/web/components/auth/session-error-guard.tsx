'use client';

import { useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';

/**
 * FE-5 §6.4 — nối `session.error` → `signOut()`.
 *
 * `auth.ts` (callback jwt/session) đẩy `RefreshAccessTokenError` / `ExchangeError`
 * ra `session.error` khi chuỗi làm mới token đứt, kèm chú thích "Apollo link sẽ
 * signOut()". Nhưng trước FE-5 KHÔNG có chỗ nào thực sự gọi `signOut` (0 hit).
 * Đây là chỗ nối: thấy error ⇒ đăng xuất sạch rồi đưa về TRANG CHỦ.
 *
 * ⚠️ 26/08/2026 — ĐẢO đích đến của FE-5 §6.4: trước đây là '/login'. Cảnh vỡ:
 * mở máy buổi sáng, cookie phiên còn nhưng access token đã hết hạn, API chưa
 * kịp lên ⇒ /auth/refresh hỏng ⇒ error ⇒ guard này ném thẳng người dùng vào
 * màn đăng nhập, dù trang chủ vốn CÔNG KHAI và khách xem được lưới Khám phá.
 * Người dùng chốt: phiên hỏng thì rơi về trang chủ như một vị khách, đừng bắt
 * đăng nhập. Ai bấm vào màn cần đăng nhập thì `proxy.ts` vẫn đẩy sang /login
 * kèm callbackUrl — không mất nhánh nào.
 *
 * Cùng ngày còn một vòng lặp NGOÀI code: cache `.next` hỏng làm mọi /api/* trả
 * 404, nên `signOut` không xoá nổi cookie ⇒ guard bắn lại vô tận (trang đăng
 * nhập tự reload liên tục). Đổi đích đến KHÔNG chữa được cảnh đó — nếu gặp
 * lại, xoá `apps/web/.next` rồi chạy lại dev server.
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
      void signOut({ redirectTo: '/' });
    }
  }, [error]);

  return null;
}
