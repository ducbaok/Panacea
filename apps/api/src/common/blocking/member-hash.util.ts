// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  memberHash — khoá TÁI DÙNG vòng ad-hoc (XH-QĐ-5, PLAN_XAHOI.md §2)      ║
// ║                                                                          ║
// ║  VÌ SAO CÓ FILE NÀY: XH-QĐ-2 buộc "một post ghim đúng một vòng", nên      ║
// ║  người dùng sẽ chọn đi chọn lại **cùng một nhóm người** ở màn tạo pin.    ║
// ║  Không có khoá nhận diện tập thành viên thì mỗi lần đăng lại đẻ thêm một  ║
// ║  `Circle` ẩn trùng nội dung — bảng phình vô ích, và trần 20 vòng/người    ║
// ║  (XH-QĐ-13, đếm CẢ ad-hoc) sẽ cháy sau vài chục lần đăng.                 ║
// ║                                                                          ║
// ║  ⚠️ FILE NÀY NẰM Ở VÙNG CHUNG CỦA HAI LUỒNG (xahoi-dieu-phoi.md §3):     ║
// ║  luồng A (đường ghi pin) và luồng B (module circles) đều cần nó, hai      ║
// ║  worktree chạy song song. Hợp đồng đã chốt để merge không đau: CÙNG       ║
// ║  đường dẫn, CÙNG chữ ký `computeMemberHash(userIds: string[]): string`.   ║
// ║  Bản nào tới trước thì bản sau dùng lại; trùng nội dung thì merge là      ║
// ║  chọn một. Cố ý KHÔNG thêm dòng nào vào `blocking/index.ts` — barrel là   ║
// ║  chỗ hai luồng chắc chắn đụng nhau mà nội dung KHÔNG trùng byte, nên      ║
// ║  bên gọi import thẳng file này.                                          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { createHash } from 'node:crypto';

/**
 * Băm một TẬP HỢP người dùng thành khoá ổn định cho `Circle.memberHash`.
 *
 * "Tập hợp", không phải "danh sách" — đó là toàn bộ điểm của hàm này:
 *   · SẮP XẾP trước khi băm ⇒ `[a,b]` và `[b,a]` ra cùng một khoá. Thiếu bước
 *     này thì hai lần chọn cùng nhóm người theo thứ tự bấm khác nhau sẽ tạo
 *     hai vòng ẩn khác nhau — đúng cái lãng phí file này sinh ra để chặn, mà
 *     lại không có lỗi nào nổ ra để ai đó phát hiện.
 *   · KHỬ TRÙNG ⇒ client gửi lặp một id không làm lệch khoá.
 *
 * Ngăn cách bằng `\n` chứ không phải nối trơn: id là cuid độ dài thay đổi được,
 * nối trơn thì `["ab","c"]` và `["a","bc"]` băm ra cùng chuỗi.
 *
 * KHÔNG trộn `ownerId` vào khoá — ràng buộc trong DB đã là `@@unique([ownerId,
 * memberHash])`, tức chủ vòng đã nằm ở cột riêng. Trộn thêm vào đây là mã hoá
 * cùng một sự thật ở hai chỗ.
 *
 * Hàm THUẦN, không chạm database: bên gọi tự quyết tra bảng hay tạo mới.
 */
export function computeMemberHash(userIds: string[]): string {
  const normalized = [...new Set(userIds)].sort();
  return createHash('sha256').update(normalized.join('\n')).digest('hex');
}
