import { NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * FE-5 §6.2 — bảo vệ nhóm route cần đăng nhập.
 *
 * ⚠️ Next 16 ĐỔI TÊN `middleware` → `proxy` (xem
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 * File phải tên `proxy.ts` ở gốc apps/web và export mặc định một hàm. Proxy nay
 * chạy ở **Node.js runtime**, nên cấu hình Auth.js đầy đủ (có fetch tới backend
 * trong callback jwt/session) dùng được, không vướng giới hạn Edge.
 *
 * Danh sách route còn NGẮN vì FE-6/FE-7 chưa dựng màn (/settings, /messages,
 * /notifications, /pin/new hiện 404). Khi màn mới ra đời, thêm vào CẢ `matcher`
 * bên dưới — matcher phải là hằng để Next phân tích lúc build.
 */
export default auth((req) => {
  if (!req.auth) {
    // callbackUrl LUÔN là đường dẫn nội bộ (pathname + search của chính request
    // này) ⇒ không có nguy cơ open-redirect. A1/A2 chỉ nhận callbackUrl bắt đầu
    // bằng '/' (kiểm lại lần nữa ở phía trang).
    const callbackUrl = req.nextUrl.pathname + req.nextUrl.search;
    const url = new URL('/login', req.nextUrl.origin);
    url.searchParams.set('callbackUrl', callbackUrl);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    '/settings/:path*',
    '/messages/:path*',
    '/notifications/:path*',
    '/pin/new/:path*',
  ],
};
