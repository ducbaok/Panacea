'use client';

import { useRouter } from 'next/navigation';
import { PinGrid } from '@/components/pin/pin-grid';
import { useExploreFeed } from '@/lib/hooks/usePaginatedQuery';

/**
 * Trang chủ ở FE-3 = lưới khám phá (QĐ-1 khách vãng lai).
 *
 * Trang chủ THẬT theo `khung-ui-ux.md` §4/§7:
 *   • Khách vãng lai → nội dung explore (đúng như đây).
 *   • Đã đăng nhập → homeFeed với 2 nhánh FOLLOWING/EXPLORE + dải gợi ý.
 * Nhánh đăng nhập là VIỆC CỦA FE-6, không phải FE-3 (xem PROMPT_FE3.md §1
 * "Ngoài phạm vi"). Ở FE-3 cả hai vai trò cùng thấy exploreFeed.
 *
 * Client Component vì Apollo là client-only (FE-0 chốt — xem
 * `lib/apollo/client.ts:13-16`). Máy chủ prerender một lượt sẽ ra nhánh
 * loading của lưới (khung xương CSS columns tất định) — đúng thiết kế §4.7
 * của brief, không phải sự cố.
 *
 * FE-4 nối `onOpen` bằng router.push('/pin/'+id). Intercepting route
 * `@modal/(.)pin/[id]` chặn ⇒ hiện modal đè lưới, URL đổi thành /pin/<id>,
 * lưới còn nguyên trong DOM phía sau (T2.1). F5 tại URL đó ⇒ trang đầy đủ.
 * Dưới 768px, modal tự đổi hình sang toàn màn variant='page' (§5.4 hướng A).
 */
export default function Home() {
  const router = useRouter();
  const { items, loading, loadingMore, hasNextPage, loadMore } = useExploreFeed();

  return (
    <div className="py-6">
      <PinGrid
        items={items}
        loading={loading}
        loadingMore={loadingMore}
        hasNextPage={hasNextPage}
        loadMore={loadMore}
        onOpen={(id) => router.push(`/pin/${id}`)}
      />
    </div>
  );
}
