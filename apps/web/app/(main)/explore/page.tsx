'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@apollo/client/react';
import {
  CategoriesDocument,
  type CategoriesQuery,
} from '@/lib/gql/graphql';
import { useExploreFeed } from '@/lib/hooks/usePaginatedQuery';
import { PinGrid } from '@/components/pin/pin-grid';

/**
 * FE-4 — B2 Khám phá.
 *
 * Cấu tạo theo mockup `Panacea.html` §3.1:
 *   • h1 "Khám phá" — Varela Round 24px, margin 0 0 14px.
 *   • Dải chip category — cuộn ngang (`overflow-x:auto`), gap 8px, padding-bottom
 *     16px. Chip đầu "Tất cả" reset filter về `null`.
 *   • Lưới bên dưới — dùng `PinGrid` (FE-3) qua `useExploreFeed({ categorySlug })`.
 *
 * ⚠️ `categorySlug` phải là **slug của Category** (backend so khớp CHÍNH XÁC —
 * B-5). Lấy giá trị từ query `categories`, ĐỪNG nhét chữ người dùng gõ (nhắc
 * `PLAN_FRONTEND.md` §6).
 *
 * Category rỗng ⇒ backend trả tập rỗng, PinGrid hiện trạng thái "chưa có pin
 * nào" — không màn trắng (T2.4).
 *
 * Bấm pin ⇒ `router.push('/pin/'+id)` ⇒ intercepting route
 * `@modal/(.)pin/[id]` chặn ⇒ modal đè lưới, URL đổi (T2.1).
 */

export default function ExplorePage() {
  const router = useRouter();
  const [categorySlug, setCategorySlug] = useState<string | null>(null);

  const catsQuery = useQuery<CategoriesQuery>(CategoriesDocument);
  const categories = catsQuery.data?.categories ?? [];

  const exploreVars = useMemo(
    () => (categorySlug ? { categorySlug } : {}),
    [categorySlug],
  );
  const feed = useExploreFeed(exploreVars);

  return (
    <div style={{ padding: '24px 0 0' }}>
      <div style={{ padding: '0 16px' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display), var(--font-be-vietnam-pro), sans-serif',
            fontSize: 24,
            margin: '0 0 14px',
            color: 'var(--color-foreground)',
          }}
        >
          Khám phá
        </h1>
        <div
          role="tablist"
          aria-label="Bộ lọc category"
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
    </div>
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
