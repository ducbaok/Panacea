// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  api-origin.ts — "API nằm ở đâu", tính LÚC CHẠY chứ không nướng lúc build ║
// ║                                                                           ║
// ║  🔴 VÌ SAO PHẢI CÓ FILE NÀY — một vòng lặp KHÔNG HỘI TỤ, đo được 27/08:   ║
// ║                                                                           ║
// ║  Next inline mọi `NEXT_PUBLIC_*` vào bundle lúc `next build`. Hạ tầng      ║
// ║  production không có ALB, nên địa chỉ công khai là IP của task ECS — mà   ║
// ║  IP đó ĐỔI mỗi lần task được thay. Kết quả:                               ║
// ║                                                                           ║
// ║     build image với IP X → deploy → task mới mang IP Y ≠ X                ║
// ║     build lại với Y      → deploy → task mới mang IP Z ≠ Y   …            ║
// ║                                                                           ║
// ║  Mỗi lần sửa cho đúng lại tự làm nó sai. `infra/README.md` §4 có nhắc      ║
// ║  "phải build lại image Web" nhưng không nhận ra rằng chính lần deploy đó   ║
// ║  đổi IP lần nữa. Triệu chứng nếu bỏ qua: trang TẢI ĐƯỢC (HTML render phía ║
// ║  máy chủ) nhưng trình duyệt gọi API vào một IP đã chết ⇒ lưới trống, đăng  ║
// ║  nhập hỏng — trông y hệt "API chết", nguyên nhân nằm chỗ khác hoàn toàn.  ║
// ║                                                                           ║
// ║  CÁCH THÁO: từ 27/08 web và API chạy CHUNG MỘT TASK ⇒ chung một IP. Nên   ║
// ║  trình duyệt không cần biết IP: nó suy ra từ chính địa chỉ trang vừa tải. ║
// ║  Đúng vĩnh viễn, đổi IP bao nhiêu lần cũng không sao, và image Web chỉ     ║
// ║  còn phải build MỘT lần.                                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

/**
 * Cổng API. Cố định theo `portMappings` của container api trong `infra/ecs.tf`.
 * Tách thành hằng có tên để nếu đổi cổng thì có đúng một chỗ phải sửa.
 */
const API_PORT = process.env.NEXT_PUBLIC_API_PORT ?? '4000';

/** Bỏ dấu `/` thừa ở cuối để ghép chuỗi không sinh ra `//graphql`. */
const trimEnd = (s: string) => s.replace(/\/+$/, '');

/**
 * Gốc HTTP của API — `http://host:4000`, không kèm đường dẫn.
 *
 * Ba tầng, theo đúng thứ tự ưu tiên:
 *
 *  1. **`NEXT_PUBLIC_API_URL` khai tường minh luôn THẮNG.** Máy dev đang đặt
 *     biến này trong `apps/web/.env`, nên toàn bộ bộ verify và mọi phép T2 giữ
 *     nguyên hành vi cũ — đổi này KHÔNG chạm tới dev. Sau này có ALB/domain thì
 *     cũng đặt biến này và nhánh suy địa chỉ tự tắt.
 *  2. **Trình duyệt**: suy từ `window.location`. Đây là nhánh chạy trên
 *     production.
 *  3. **Phía máy chủ** (SSR, route handler): `API_INTERNAL_URL`. ⚠️ CỐ Ý không
 *     đặt tiền tố `NEXT_PUBLIC_` — biến không có tiền tố đó KHÔNG bị inline lúc
 *     build, nên nó đọc được lúc chạy từ task definition. Mặc định 127.0.0.1 vì
 *     API là container CÙNG task: gọi qua localhost thì không ra internet,
 *     không phụ thuộc IP công khai, và không tính tiền data transfer.
 */
export function apiOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_API_URL;
  if (explicit) return trimEnd(explicit);

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
  }

  return trimEnd(process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000');
}

/** Điểm cuối GraphQL. */
export function graphqlUrl(): string {
  return process.env.NEXT_PUBLIC_GRAPHQL_URL || `${apiOrigin()}/graphql`;
}

/**
 * Điểm cuối WebSocket cho GraphQL Subscriptions.
 *
 * Suy từ `apiOrigin()` chứ không ghép tay: `http:` → `ws:` và `https:` → `wss:`
 * đi cùng nhau. Ghép cứng `ws://` là ngày có HTTPS thì trình duyệt chặn vì nội
 * dung hỗn hợp, và thông báo lỗi chỉ nói "connection failed".
 */
export function wsUrl(): string {
  return process.env.NEXT_PUBLIC_WS_URL || `${apiOrigin().replace(/^http/, 'ws')}/graphql`;
}
