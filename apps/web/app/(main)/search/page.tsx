import { SearchView } from '@/components/search/search-view';

/**
 * D1 — /search. Server component mỏng: chỉ đọc `?q=` rồi trao cho SearchView
 * (client) — Apollo là client-only nên không có query nào chạy ở server.
 *
 * ⚠️ Next 16: `searchParams` là Promise (bẫy 6 §4). Phải await, đọc `params.q`
 * trực tiếp cho `undefined` không báo lỗi.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const initialQuery = typeof q === 'string' ? q : '';
  return <SearchView initialQuery={initialQuery} />;
}
