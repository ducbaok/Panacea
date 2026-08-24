// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  member-hash — dấu vân tay của MỘT TẬP thành viên (XH-QĐ-5, XH-QĐ-13)     ║
// ║  (XH-4a, 24/08/2026 — PLAN_XAHOI.md §2 ghi chú 2)                         ║
// ║                                                                           ║
// ║  Vì sao tồn tại: khán giả ad-hoc ("chọn người ngay lúc đăng") được lưu     ║
// ║  bằng CHÍNH `Circle` với `isAdHoc = true` — một cơ chế khán giả duy nhất,  ║
// ║  không có bảng `PinAudience` thứ hai. Không có băm này thì mỗi lần đăng    ║
// ║  cho đúng ba người đó lại đẻ thêm một vòng ẩn, và bảng `Circle` phình      ║
// ║  tuyến tính theo số lần đăng chứ không theo số nhóm bạn thật.              ║
// ║                                                                           ║
// ║  Ràng buộc DB đi kèm (đã có từ XH-1): `@@unique([ownerId, memberHash])`.   ║
// ║  Postgres coi NULL ≠ NULL nên vòng CÓ TÊN (memberHash null) không đụng     ║
// ║  nhau — chỉ vòng ad-hoc mới bị ép duy nhất. Đúng chủ đích.                 ║
// ║                                                                           ║
// ║  ⚠️ FILE DÙNG CHUNG GIỮA LUỒNG A (pins) VÀ LUỒNG B (circles) —            ║
// ║  `xahoi-dieu-phoi.md` §6. Đổi thuật toán băm ở đây là đổi Ý NGHĨA của cột  ║
// ║  `Circle.memberHash` đang nằm trong DB: mọi vòng ad-hoc cũ lập tức KHÔNG   ║
// ║  tái dùng được nữa (không lỗi, chỉ âm thầm đẻ vòng mới). Muốn đổi thì phải ║
// ║  backfill, và phải notify theo LUẬT NOTIFY.                                ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { createHash } from 'node:crypto';

/**
 * Trần hạn mức của vòng tròn — XH-QĐ-13, `PLAN_XAHOI.md` §1.
 *
 * Đặt ở đây (chứ không ở `circles/`) vì CẢ HAI luồng đều phải tôn trọng cùng
 * một con số: đường ghi pin tạo vòng ad-hoc (luồng A) và API vòng tròn (luồng
 * B). Hai bản sao của con số 20 là hai chỗ để lệch nhau.
 *
 * ⚠️ `MAX_CIRCLES_PER_USER` ĐẾM CẢ VÒNG AD-HOC. Đó là chủ đích của XH-QĐ-13:
 * vòng ad-hoc ẩn khỏi màn quản lý nhưng vẫn là bản ghi thật, vẫn tốn chỗ, và
 * nếu không tính vào trần thì trần chỉ chặn được đúng đường tạo vòng có tên —
 * tức là không chặn gì cả.
 */
export const MAX_CIRCLES_PER_USER = 20;

/** Trần thành viên của MỘT vòng — XH-QĐ-13. */
export const MAX_CIRCLE_MEMBERS = 50;

/**
 * Tên đặt cho vòng ad-hoc sinh ra từ đường ghi pin. Vòng này ẩn khỏi
 * `/settings` (XH-QĐ-5) nên tên chỉ hiện khi người dùng bấm "lưu vòng này lại"
 * và được đổi tên ngay tại đó — giữ một hằng dùng chung để luồng B nhận diện
 * được vòng nào là do đường ghi pin sinh ra.
 */
export const AD_HOC_CIRCLE_NAME = 'Khán giả chọn tại chỗ';

/**
 * Băm một TẬP HỢP người dùng thành chuỗi hex sha256 ổn định.
 *
 * Hai phép chuẩn hoá TRƯỚC khi băm, cả hai đều bắt buộc:
 *   1. **khử trùng** — `[a, a, b]` và `[a, b]` là CÙNG một khán giả;
 *   2. **sắp xếp**  — `[b, a]` và `[a, b]` cũng vậy. Client gửi theo thứ tự
 *      người dùng bấm chọn, thứ tự đó không mang ý nghĩa nào.
 * Bỏ một trong hai ⇒ cùng một nhóm bạn cho ra hai băm khác nhau ⇒ đẻ hai vòng
 * ad-hoc — đúng cái lãng phí mà cột `memberHash` sinh ra để chặn.
 *
 * Ngăn cách bằng `\n` (ký tự KHÔNG xuất hiện trong cuid) để `["ab","c"]` không
 * băm ra cùng chuỗi với `["a","bc"]`.
 *
 * KHÔNG kiểm tra rỗng ở đây — hàm này thuần và không biết ngữ cảnh. Bên gọi
 * phải từ chối danh sách rỗng TRƯỚC (vòng 0 người là khán giả không có ai, tức
 * ONLY_ME viết vòng vo).
 */
export function computeMemberHash(userIds: string[]): string {
  const canonical = [...new Set(userIds)].sort().join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}
