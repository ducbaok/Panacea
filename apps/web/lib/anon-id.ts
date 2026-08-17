/**
 * FE-10 (wire B-4) — danh tính KHÁCH VÃNG LAI cho đo lượt xem/lượt bấm pin.
 *
 * `trackPinView`/`trackPinClick` chạy dưới `GqlOptionalAuthGuard`: khách CŨNG
 * được đếm, nhưng backend cần một mã để chống trùng (khoá Redis
 * `track:<kind>:<pinId>:<u:userId|a:anonId>`, cửa sổ 30 phút). Mã đó đọc từ
 * header **`x-anon-id`**. Không có token và cũng không có header ⇒ backend CỐ Ý
 * không đếm (trả `false`), nên thiếu hàm này là mất im lặng toàn bộ số của khách.
 *
 * Ràng buộc từ backend: **trần 64 ký tự** — dài hơn thì coi như không có.
 * `crypto.randomUUID()` cho 36 ký tự, thoải mái trong trần.
 *
 * Người ĐĂNG NHẬP lấy danh tính từ token và token LUÔN THẮNG anonId (luật
 * §3.5/14), nên vẫn gửi header là vô hại — không cần phân nhánh theo phiên.
 *
 * `localStorage` (không phải `sessionStorage`): debounce 30 phút chỉ có nghĩa khi
 * mã sống qua lần đóng tab. Chế độ ẩn danh / chặn storage ⇒ trả null và mất số
 * của khách đó; đó là đánh đổi chấp nhận được, KHÔNG được ném lỗi làm vỡ query.
 */

const STORAGE_KEY = 'antigravity:anon-id';
const MAX_ANON_ID_LENGTH = 64;

/**
 * Trả mã khách bền vững, tạo mới nếu chưa có. `null` khi không có `window`
 * (prerender phía server) hoặc `localStorage` không dùng được.
 */
export function getAnonId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    // Mã cũ quá trần (dữ liệu rác / bản khác ghi vào) thì cấp lại — giữ nguyên là
    // để backend lặng lẽ bỏ qua mọi lần đếm về sau.
    if (existing && existing.length > 0 && existing.length <= MAX_ANON_ID_LENGTH) {
      return existing;
    }
    const fresh =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Safari private mode / storage bị chặn: đừng để vỡ request.
    return null;
  }
}
