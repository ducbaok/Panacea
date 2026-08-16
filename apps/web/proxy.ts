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
 * FE-7 thêm 4 route cần đăng nhập: /pin/new (tạo pin), /pin/:id/edit (sửa pin),
 * /board/new + /board/:id/edit (tạo/sửa board). ⚠️ BẪY path-to-regexp: mẫu
 * '/pin/new/:path*' KHÔNG khớp CHÍNH '/pin/new' (nó cần ít nhất một segment con)
 * ⇒ phải liệt kê '/pin/new' RIÊNG, nếu không khách vào thẳng /pin/new sẽ lọt
 * lưới, không bị đẩy về /login (phép T2.2). Matcher phải là hằng để Next phân
 * tích lúc build; thêm màn mới thì bổ sung vào đây.
 *
 * FE-8 thêm '/notifications' CHÍNH (bare) cùng lý do trên: '/notifications/:path*'
 * chỉ khớp route con, không khớp chính '/notifications' — trang D2 cần đăng nhập.
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
    '/notifications',
    '/notifications/:path*',
    '/pin/new',
    '/pin/new/:path*',
    '/pin/:id/edit',
    '/board/new',
    '/board/:id/edit',
  ],
};
