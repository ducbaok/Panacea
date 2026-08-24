// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Hạn mức của vòng tròn — XH-QĐ-13 (PLAN_XAHOI.md §1, chốt 21/08/2026)    ║
// ║                                                                          ║
// ║  Hai con số này là QUYẾT ĐỊNH ĐÃ CHỐT, không phải hằng số tiện tay. Đổi  ║
// ║  chúng là đổi nguồn sự thật ⇒ DỪNG và notify chủ dự án                   ║
// ║  (xahoi-dieu-phoi.md §1 LUẬT NOTIFY), rồi sửa ĐỒNG THỜI:                 ║
// ║  `PLAN_XAHOI.md` §1 · `docs/xahoi-phi-chuc-nang.md` · file này ·         ║
// ║  `scripts/verify/steps/73-circles.mjs`.                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

/**
 * Trần số vòng mỗi người — **ĐẾM CẢ VÒNG AD-HOC** (XH-QĐ-13 ghi thẳng điều
 * này). Đây là vế dễ quên nhất: vòng ad-hoc ẩn khỏi màn quản lý, nên nếu chỉ
 * đếm vòng đặt tên thì trần này không chặn được đúng thứ nó sinh ra để chặn —
 * người dùng đăng 500 pin với 500 nhóm người khác nhau vẫn "chưa có vòng nào".
 */
export const MAX_CIRCLES_PER_USER = 20;

/** Trần thành viên mỗi vòng. Đồng bộ với `@ArrayMaxSize` ở 2 DTO. */
export const MAX_MEMBERS_PER_CIRCLE = 50;

/** Độ dài tên vòng — cùng ngưỡng với `Board.name` để FE dùng chung một ô nhập. */
export const CIRCLE_NAME_MAX_LENGTH = 100;

/**
 * Khoảng hợp lệ của `rank` ("mức độ thân thiết").
 *
 * `rank` KHÔNG phải một loại vòng khác — nó chỉ là số để xếp thứ tự, và đó
 * chính là XH-QĐ ghi ở PLAN_XAHOI.md §2 ghi chú 1: **"level thân thiết" và
 * "vòng tự đặt tên" là MỘT cơ chế, hai cách trình bày**. `rank = null` ⇒ vòng
 * tự đặt tên; `rank` có số ⇒ giao diện trình bày như một level. Dựng bảng
 * riêng cho "level" là tự tạo nguồn sự thật thứ hai.
 */
export const CIRCLE_RANK_MIN = 0;
export const CIRCLE_RANK_MAX = 999;
