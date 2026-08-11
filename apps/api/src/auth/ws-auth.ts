// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  WebSocket Auth cho GraphQL Subscriptions                                ║
// ║                                                                          ║
// ║  VẤN ĐỀ GỐC (phát hiện khi sửa P0 #3):                                   ║
// ║  `GraphQLModule.context` được gọi ở HAI đường hoàn toàn khác nhau:       ║
// ║    • HTTP  → Apollo Express truyền `{ req, res }`                        ║
// ║    • WS    → graphql-ws truyền `Context { connectionParams, extra }`     ║
// ║  Code cũ viết `context: ({ req, res }) => ({ req, res })` nên trên nhánh ║
// ║  WebSocket `req` luôn `undefined`. Hệ quả dây chuyền:                    ║
// ║    1. `GqlAuthGuard.getRequest()` trả `undefined` → passport-jwt nổ.     ║
// ║    2. `@CurrentUser()` đọc `req.user` → TypeError.                       ║
// ║    3. Subscription filter đọc `context.req.user` → luôn undefined.       ║
// ║  → Cả 2 subscription CHƯA BAO GIỜ chạy được. Xem LEARNING_NOTES mục 8.  ║
// ║                                                                          ║
// ║  CÁCH SỬA: dựng một "request giả" cho nhánh WS có đúng 1 field mà        ║
// ║  passport-jwt cần (`headers.authorization`), rồi để nguyên GqlAuthGuard  ║
// ║  chạy như trên HTTP. Không nhánh hóa guard, không code xác thực song      ║
// ║  song — một đường xác thực duy nhất cho cả HTTP lẫn WebSocket.           ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser, JwtClaims } from './strategies/jwt.strategy';

/**
 * "Request" tối thiểu mà nhánh WebSocket dựng ra.
 *
 * passport-jwt chỉ đọc đúng `headers.authorization` (qua
 * `ExtractJwt.fromAuthHeaderAsBearerToken()`), còn `user` là chỗ
 * `AuthGuard` ghi kết quả `JwtStrategy.validate()` vào — y hệt HTTP.
 *
 * CỐ Ý không tự dịch `sub → userId` ở file này: theo `jwt.strategy.ts`,
 * `JwtStrategy.validate()` là RANH GIỚI DUY NHẤT giữa `JwtClaims` và
 * `AuthUser`. Thêm một chỗ dịch thứ hai chính là cách bug #1 ra đời.
 */
export interface WsRequest {
  headers: { authorization?: string };
  user?: AuthUser;
  /**
   * IP của client, lấy từ socket của bước HTTP upgrade.
   *
   * Có mặt ở đây vì `ThrottlerGuard.getTracker()` mặc định đọc đúng `req.ip`
   * để phân biệt client. Thiếu field này thì mọi kết nối WebSocket cùng cho ra
   * tracker `undefined` ⇒ dùng CHUNG một khoá rate-limit ⇒ một client có thể
   * làm cạn quota của toàn bộ người dùng còn lại.
   */
  ip?: string;
}

/**
 * graphql-ws `extra` sau khi onConnect gắn thêm request giả vào.
 *
 * Đặt tên `authRequest` chứ KHÔNG phải `request`: adapter `ws` của graphql-ws
 * đã dùng sẵn `extra.request` cho IncomingMessage của bước HTTP upgrade.
 * Ghi đè lên đó là kiểu bug âm thầm nhất — chạy vẫn được cho tới ngày cần
 * đọc IP/header gốc của kết nối thì mới phát hiện nó đã bị thay mất.
 */
export interface WsExtra {
  authRequest?: WsRequest;
  /** IncomingMessage của bước upgrade — do adapter `ws` của graphql-ws đặt sẵn. */
  request?: { socket?: { remoteAddress?: string } };
}

/**
 * Tách token khỏi header dạng `Bearer <token>`.
 * Trả `null` nếu thiếu header, sai scheme, hoặc không có phần token.
 */
export function extractBearerToken(rawHeader: unknown): string | null {
  if (typeof rawHeader !== 'string') return null;

  const [scheme, token] = rawHeader.trim().split(/\s+/);
  if (!token || scheme.toLowerCase() !== 'bearer') return null;

  return token;
}

/**
 * Tạo hàm `onConnect` cho graphql-ws.
 *
 * Trả `false` ⇒ graphql-ws đóng socket với code **4403 (Forbidden)** NGAY tại
 * bước handshake. Đây là điểm khác biệt quan trọng so với chỉ dựa vào guard:
 * client sai token không mở được kết nối, thay vì mở xong rồi mới bị từ chối ở
 * từng operation.
 *
 * ⚠️ ĐỪNG đổi lại thành `throw`: `throw` trong `onConnect` làm graphql-ws đóng
 * bằng **4500 (Internal Server Error)** chứ không phải 4403. Sai về mặt ngữ
 * nghĩa (token sai là lỗi client, không phải lỗi server), và nó còn đẩy mọi
 * lần xác thực thất bại vào log lỗi nội bộ — đúng chỗ để một cuộc dò token
 * bị chìm trong nhiễu. Đây từng là hành vi thực tế của code này dù comment ghi
 * 4403; đo bằng WS client thật mới thấy.
 *
 * Ở đây token được verify rồi... vứt đi payload. Nghe phí, nhưng có chủ đích:
 * mục tiêu của bước này là *fail fast*, còn việc dịch claims → `AuthUser` vẫn
 * để `JwtStrategy.validate()` làm (một nguồn sự thật duy nhất).
 *
 * LƯU Ý VỀ TOKEN HẾT HẠN: access token sống 15 phút, còn WebSocket có thể mở
 * hàng giờ. Vì guard chạy lại ở MỖI subscription operation, token hết hạn sẽ
 * bị chặn ở lần subscribe kế tiếp. Nhưng một subscription đã mở thì vẫn chạy
 * tiếp — muốn cắt giữa chừng phải thêm cơ chế re-auth định kỳ (chưa làm ở v1).
 */
export function createWsOnConnect(jwtService: JwtService, configService: ConfigService) {
  const logger = new Logger('GqlWsAuth');

  // `extra` khai `unknown` để khớp đúng kiểu `Context` của graphql-ws (thư viện
  // để generic `Extra = unknown` khi không cấu hình). Cast xuống `WsExtra` ở
  // dưới — chỗ này biết rõ adapter đang dùng là `ws`.
  return (context: { connectionParams?: Record<string, unknown>; extra: unknown }): boolean => {
    const params = context.connectionParams ?? {};
    // Client có thể gửi 'Authorization' hoặc 'authorization' — chấp nhận cả hai.
    const rawHeader = (params.Authorization ?? params.authorization) as string | undefined;
    const token = extractBearerToken(rawHeader);

    if (!token) {
      logger.warn('WS connection bị từ chối: thiếu connectionParams.Authorization');
      return false;
    }

    try {
      jwtService.verify<JwtClaims>(token, {
        secret: configService.get<string>('jwt.secret'),
      });
    } catch {
      logger.warn('WS connection bị từ chối: access token không hợp lệ hoặc đã hết hạn');
      return false;
    }

    // Gắn request giả vào `extra` — object này được graphql-ws giữ nguyên
    // suốt vòng đời socket và truyền lại cho `context` ở mỗi operation.
    const extra = context.extra as WsExtra;
    extra.authRequest = {
      headers: { authorization: rawHeader },
      // CHỈ ĐỌC `extra.request`, không ghi đè (xem chú thích ở WsExtra).
      ip: extra.request?.socket?.remoteAddress,
    };

    return true;
  };
}

/**
 * Chuẩn hóa context cho CẢ HAI transport về cùng một shape `{ req, res }`,
 * để mọi guard / decorator phía sau không cần biết mình đang ở HTTP hay WS.
 */
export function buildGraphqlContext(rawContext: any): { req: any; res?: any } {
  // ── HTTP: Apollo Express truyền thẳng { req, res } ────────────────────────
  if (rawContext?.req) {
    return { req: rawContext.req, res: rawContext.res };
  }

  // ── WebSocket: graphql-ws truyền Context { connectionParams, extra } ──────
  // `extra.authRequest` do createWsOnConnect() gắn vào ở bước handshake.
  // Fallback `{ headers: {} }` để guard trả 401 gọn gàng thay vì TypeError,
  // phòng trường hợp có đường vào nào bỏ qua onConnect.
  const request: WsRequest = rawContext?.extra?.authRequest ?? { headers: {} };
  return { req: request };
}
