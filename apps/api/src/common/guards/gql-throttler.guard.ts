import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard cho GraphQL — phải override `getRequestResponse()` vì
 * `context.switchToHttp()` không dùng được ở nhánh GraphQL.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  TẠI SAO PHẢI CÓ `res` GIẢ CHO WEBSOCKET                                 ║
 * ║                                                                          ║
 * ║  Guard này là APP_GUARD toàn cục nên nó chạy cho CẢ subscription, không   ║
 * ║  chỉ query/mutation. Nhưng `ThrottlerGuard.handleRequest()` luôn gọi     ║
 * ║      res.header('X-RateLimit-Limit', ...)                                ║
 * ║  để trả quota về client. Trên nhánh WebSocket KHÔNG tồn tại HTTP          ║
 * ║  response — `buildGraphqlContext()` cố tình chỉ trả `{ req }` — nên       ║
 * ║  `res` là `undefined` và guard nổ:                                       ║
 * ║      TypeError: Cannot read properties of undefined (reading 'header')    ║
 * ║                                                                          ║
 * ║  Lỗi này xảy ra TRƯỚC cả GqlAuthGuard, tức là mọi `subscribe` đều chết ở  ║
 * ║  đây. Đó là lý do `messageReceived` và `notificationReceived` VẪN chưa    ║
 * ║  chạy được sau đợt sửa P0 #3 — đợt đó chữa đúng phần context/auth, nhưng ║
 * ║  guard throttler nằm trước lại chưa ai chạm tới. `nest build` exit 0 ở    ║
 * ║  cả hai đợt vì thư viện khai `res` kiểu `any`.                            ║
 * ║                                                                          ║
 * ║  CÁCH SỬA: đưa vào một `res` giả có `header()` rỗng, thay vì bỏ throttle  ║
 * ║  cho subscription. Chủ đích: subscription VẪN bị đếm và VẪN bị chặn khi   ║
 * ║  quá quota — chỉ có phần "báo quota về client qua header" là không làm    ║
 * ║  được, vì WebSocket không có chỗ để đặt header. Bỏ throttle sẽ biến       ║
 * ║  `/graphql` qua WS thành đường vòng không giới hạn tốc độ.               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  getRequestResponse(context: ExecutionContext) {
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      return { req: http.getRequest(), res: http.getResponse() };
    }

    const gqlCtx = GqlExecutionContext.create(context);
    const ctx = gqlCtx.getContext();

    // Nhánh WebSocket: không có `res`. Trả stub để guard chạy trọn logic đếm
    // rồi bỏ đi phần set header.
    return { req: ctx.req, res: ctx.res ?? { header: () => undefined } };
  }
}
