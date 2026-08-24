// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Visibility — bốn cấp khán giả của một pin (XH-QĐ-1…7)                     ║
// ║  (XH-4a, 24/08/2026 — PLAN_XAHOI.md §2 · xahoi-tinh-nang.md §3)            ║
// ║                                                                           ║
// ║  ⚠️ BẢN SAO CÓ CHỦ ĐÍCH của `enum Visibility` trong schema.prisma. Cùng    ║
// ║  khuôn với `comments/entities/reaction-type.enum.ts` (cũng chép tay bản    ║
// ║  của Prisma). Lý do KHÔNG import bản của Prisma:                           ║
// ║  `packages/database/src/index.ts` chỉ re-export ReactionType /             ║
// ║  NotificationType / CollaboratorRole; thêm `Visibility` vào đó là lấn sang ║
// ║  vùng file của luồng khác (xahoi-dieu-phoi.md §3) nên phải notify trước.   ║
// ║  Đã ghi vào mục "docs/việc cần dọn" của báo cáo XH-4a.                     ║
// ║                                                                           ║
// ║  Lệch giá trị với DB thì KHÔNG im lặng: Postgres từ chối giá trị lạ của    ║
// ║  kiểu enum ngay lúc INSERT (22P02), tức lỗi nổ ở request đầu tiên chứ      ║
// ║  không phải một feed sai âm thầm.                                         ║
// ║                                                                           ║
// ║  KHÔNG dùng `enum` của TypeScript mà dùng object `as const`: thành viên    ║
// ║  của string-enum là kiểu DANH ĐỊNH, không gán được vào union chuỗi mà      ║
// ║  Prisma khai cho cột `Pin.visibility` — `as const` cho ra đúng union đó,   ║
// ║  nên đường ghi không cần một cú `as any` nào.                             ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { registerEnumType } from '@nestjs/graphql';

export const Visibility = {
  /** Tất cả, kể cả khách chưa đăng nhập. Mặc định — hành vi cũ của mọi pin. */
  PUBLIC: 'PUBLIC',
  /** Người đang theo dõi TÁC GIẢ. Chiều dễ viết ngược — xem visible-pins.util.ts. */
  FOLLOWERS: 'FOLLOWERS',
  /** Thành viên của ĐÚNG MỘT vòng tròn ghim vào pin (XH-QĐ-2). */
  CIRCLE: 'CIRCLE',
  /** Chỉ tác giả. */
  ONLY_ME: 'ONLY_ME',
} as const;

export type Visibility = (typeof Visibility)[keyof typeof Visibility];

registerEnumType(Visibility, {
  name: 'Visibility',
  description: 'Khán giả của pin — PUBLIC · FOLLOWERS · CIRCLE · ONLY_ME',
});
