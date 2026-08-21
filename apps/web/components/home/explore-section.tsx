'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@apollo/client/react';
import { CategoriesDocument, type CategoriesQuery } from '@/lib/gql/graphql';
import { useExploreFeed } from '@/lib/hooks/usePaginatedQuery';
import { PinGrid } from '@/components/pin/pin-grid';

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
export function ExploreSection({ skip = false }: { skip?: boolean }) {
  const router = useRouter();
  const [categorySlug, setCategorySlug] = useState<string | null>(null);

  const catsQuery = useQuery<CategoriesQuery>(CategoriesDocument, { skip });
  const categories = catsQuery.data?.categories ?? [];

  const exploreVars = useMemo(
    () => (categorySlug ? { categorySlug } : {}),
    [categorySlug],
  );
  const feed = useExploreFeed(exploreVars, { skip });

  return (
    <>
      {/* Dải chip tự mang padding ngang: PinGrid bên dưới PHẢI chạm mép để
          masonry tính đúng số cột (nó đo bề rộng container). */}
      <div style={{ padding: '0 16px' }}>
        <div
          role="tablist"
          aria-label="Bộ lọc chủ đề"
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
            label="Tất cả"
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
          Chưa có pin nào ở mục này.
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
