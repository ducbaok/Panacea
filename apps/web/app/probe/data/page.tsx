/*
 * FE-0b — Trang probe TẦNG DỮ LIỆU.
 *
 * TEMPORARY — xoá khi FE-4/FE-6 dựng màn thật.
 *
 * Trang này CỐ TÌNH XẤU: bảng thô, không style. Mục đích duy nhất là chứng
 * minh tầng operation + tầng error-mapping chạy được TRƯỚC KHI có UI thật.
 *
 * Các phép nghiệm thu T2 (§7 của brief) hiện ra ở đây, đọc ngay bằng mắt:
 *   [E] ExploreFeed(first:6)  — 2 nhánh isSavedByViewer T/F trong CÙNG 1 response
 *   [H] HomeFeed(first:3)     — source = FOLLOWING / EXPLORE
 *   [C] PinComments(pin_1_id) — tầng 1
 *   [R] CommentReplies(cmt_1) — tầng 2, gọi RIÊNG (không nested)
 *   [T] Test unauth: chưa login gọi `me` → mapError = 'unauthenticated'
 *   [P] loadMore 3 lần → tập id không trùng, không thiếu
 *
 * Guard NODE_ENV: production trả 404 để không lộ ra ngoài.
 * Client Component: mọi hook Apollo cần cây SessionProvider + ApolloProvider
 * ở providers.tsx.
 */
import { notFound } from 'next/navigation';
import { ProbeDataView } from './probe-view';

export const dynamic = 'force-dynamic';

export default function ProbeDataPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ProbeDataView />;
}
