'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@apollo/client/react';
import {
  CategoriesDocument,
  type CategoriesQuery,
  type CategoriesQueryVariables,
} from '@/lib/gql/graphql';
import { useExploreFeed } from '@/lib/hooks/usePaginatedQuery';
import { PinGrid } from '@/components/pin/pin-grid';
import { useT } from '@/lib/i18n/provider';

/**
 * REVIEW-1 (#2) — Khối "Khám phá": dải chip chủ đề + lưới lọc theo chủ đề.
 *
 * Vì sao khối này chuyển từ trang riêng về trang chủ:
 *   Thiết kế cũ tách `/` và `/explore` làm hai màn, và `docs/khung-ui-ux.md`
 *   §QĐ-1 ghi rõ thứ phân biệt chúng là dải gợi ý ở trang chủ. Nhưng dải đó
 *   thuộc đợt FE-ONBOARDING chưa làm, nên trên sản phẩm thật người dùng thấy
 *   hai mục nav dẫn tới hai màn giống hệt nhau — chính là điều họ báo lại
 *   (18/08/2026). Người dùng chốt: bỏ mục "Khám phá" ở nav, đưa dải chip vào
 *   tab "Khám phá" sẵn có của trang chủ. `/explore` nay chỉ còn redirect.
 *
 * Dùng `exploreFeed` trực tiếp thay vì `homeFeed(source: EXPLORE)`: hai đường
 * này trả CÙNG dữ liệu (`pins.service.ts` — nhánh EXPLORE của `homeFeed` gọi
 * lại chính `exploreFeed`), nhưng chỉ `exploreFeed` nhận `categorySlug`.
 *
 * ⚠️ `categorySlug` phải là **slug của Category** (backend so khớp CHÍNH XÁC —
 * B-5). Lấy từ query `categories`, ĐỪNG nhét chữ người dùng gõ.
 */

/**
 * Dải chip chủ đề: từ 26/08/2026 KHÔNG còn cờ bật/tắt.
 *
 * Lịch sử để không ai bật lại nhánh cũ: ngày 25/08 cả dải chip bị tắt cứng
 * bằng `SHOW_CATEGORY_CHIPS = false`, lý do là 12 Category seed chưa gán nhãn
 * cho pin nào ⇒ bấm chip ra lưới trống, người dùng tưởng app hỏng. Triệu chứng
 * đúng, nhưng tầng sai: nó tắt luôn phần "Khám phá" của KHÁCH VÃNG LAI, vốn
 * không có thanh tab nguồn nào khác để biết mình đang xem gì (26/08 người dùng
 * báo lại: "chưa đăng nhập không có khám phá à, trống trơn thế").
 *
 * Cách chữa nay nằm ở BACKEND: `categories(withPinsOnly: true)` chỉ trả về
 * danh mục có ít nhất một pin mà CHÍNH người đang xem mở ra được (cùng bộ lọc
 * với `exploreFeed` — xem `PinsService.categoriesWithVisiblePins`). Chip nào
 * hiện ra là chip đó chắc chắn có nội dung, nên không còn gì để tắt; gán nhãn
 * thêm về sau thì chip tự mọc, không phải sửa code lần nữa.
 */

export function ExploreSection({ skip = false }: { skip?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [categorySlug, setCategorySlug] = useState<string | null>(null);

  const catsQuery = useQuery<CategoriesQuery, CategoriesQueryVariables>(CategoriesDocument, {
    variables: { withPinsOnly: true },
    skip,
  });
  const categories = catsQuery.data?.categories ?? [];

  // Không danh mục nào có pin ⇒ ẩn CẢ dải, kể cả chip "Tất cả": một dải chỉ có
  // đúng một chip không lọc được gì, nó chỉ chiếm chỗ và làm người dùng tưởng
  // phần lọc đang hỏng. Cũng là đường đi của DB rỗng hoàn toàn.
  const showChips = categories.length > 0;

  const exploreVars = useMemo(
    () => (categorySlug ? { categorySlug } : {}),
    [categorySlug],
  );
  const feed = useExploreFeed(exploreVars, { skip });

  return (
    <>
      {/* Dải chip tự mang padding ngang: PinGrid bên dưới PHẢI chạm mép để
          masonry tính đúng số cột (nó đo bề rộng container). */}
      {showChips && (
        <div style={{ padding: '0 16px' }}>
          <div
            role="tablist"
            aria-label={t('home.categoryTablist')}
            data-testid="category-chips"
            style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              paddingBottom: 16,
              marginBottom: 4,
            }}
          >
            <CategoryChip
              label={t('home.categoryAll')}
              active={categorySlug === null}
              onClick={() => setCategorySlug(null)}
            />
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                label={c.icon ? `${c.icon} ${c.name}` : c.name}
                active={categorySlug === c.slug}
                onClick={() => setCategorySlug(c.slug)}
              />
            ))}
          </div>
        </div>
      )}

      <PinGrid
        items={feed.items}
        loading={feed.loading}
        loadingMore={feed.loadingMore}
        hasNextPage={feed.hasNextPage}
        loadMore={feed.loadMore}
        onOpen={(id) => router.push(`/pin/${id}`)}
      />

      {!feed.loading && feed.items.length === 0 && (
        <div
          role="status"
          data-state="empty"
          style={{
            padding: '48px 16px',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: 14,
          }}
        >
          {t('home.exploreEmpty')}
        </div>
      )}
    </>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 'none',
        padding: '8px 14px',
        borderRadius: 'var(--radius-button)',
        border: active ? '1px solid var(--color-primary-strong)' : '1px solid var(--color-border)',
        background: active ? 'var(--color-primary-soft)' : 'var(--color-surface)',
        color: active ? 'var(--color-primary-strong)' : 'var(--color-foreground)',
        fontWeight: 600,
        fontSize: 13,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
