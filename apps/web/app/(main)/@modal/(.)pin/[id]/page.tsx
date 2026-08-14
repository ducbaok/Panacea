import { PinModal } from './pin-modal';

/**
 * FE-4 — Intercepting route MODAL cho `/pin/[id]`.
 *
 * 🔴 §5.1 PROMPT_FE4.md — Đây là `(.)` chứ KHÔNG phải `(..)`.
 * Doc trong `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/intercepting-routes.md`
 * xác nhận: quy ước `(..)` dựa trên **route segment**, KHÔNG tính thư mục
 * `@slot` (Parallel Routes) và KHÔNG tính `(group)` (Route Group). Sau khi
 * bỏ cả hai, `@modal` đứng ở cấp gốc, `pin` cũng ở cấp gốc ⇒ **cùng cấp**
 * ⇒ `(.)`.
 *
 * Trực giác hệ-thống-file (đếm cấp) sẽ dẫn tới `(..)` — sai. Ví dụ chuẩn
 * `app/@auth/(.)login/page.tsx` trong `parallel-routes.md` §Modals.
 *
 * ⚠️ `params` là Promise trong Next 16.2.6 (§5.2 PROMPT_FE4.md).
 * `params.id` ở đây cho `undefined` mà không báo lỗi.
 */
export default async function InterceptedPinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PinModal id={id} />;
}
