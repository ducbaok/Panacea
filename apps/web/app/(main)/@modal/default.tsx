/**
 * Fallback cho parallel route slot `@modal`.
 *
 * QĐ-2 dùng intercepting route `@modal/(.)pin/[id]` để mở modal đè lên lưới
 * khi bấm pin từ danh sách. Khi KHÔNG có route nào khớp, Next.js đòi slot
 * phải có `default.tsx` — nếu thiếu, mọi điều hướng khách sẽ 404 (Next tưởng
 * slot bị mất khớp).
 *
 * Trả null ⇒ layout render một khoảng trống, không thêm DOM node.
 *
 * FE-4 sẽ thêm `@modal/(.)pin/[id]/page.tsx` — file này KHÔNG cần sửa.
 */
export default function ModalDefault() {
  return null;
}
