'use client';

import { useCallback, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';

/**
 * FE-0 QĐ đã chốt: MỘT hook phân trang cho TOÀN app — không ngoại lệ nào.
 *
 * Cơ sở kỹ thuật (đã kiểm apps/api/schema.graphql 2026-08-12):
 *   • Cả 8 `PaginatedXxx` (PaginatedUsers/Pins/Comments/Notifications/Boards/
 *     SavedPins/Conversations/Messages) chung ĐÚNG shape:
 *       { items: [T!]!, pageInfo: PageInfo! }
 *   • `PageInfo { hasNextPage: Boolean!, endCursor: String }`
 *   • Tham số con trỏ luôn tên `after: String`.
 *   • Cursor ở `boardPins` là 3-phần (sortOrder asc, createdAt desc, id desc);
 *     các query khác là 2-phần. Hook coi cursor là CHUỖI MỜ — không decode ⇒
 *     bất đối xứng đó vô hại.
 *
 * Vì sao P1 Đợt 2 làm hook chung khả thi: trước đó `userBoards`/`boardsFollowedByUser`/
 * `conversationMessages`/`messagesInConversation` dùng kiểu cũ (`cursor` + `skip:1`);
 * đợt đó đã chuyển hết sang keyset. Nếu ai đó thấy code cũ `skip:1` là dấu hiệu
 * chưa merge P1 — hỏi trước khi phỏng theo.
 */

export interface PaginatedShape<TItem> {
  items: TItem[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor?: string | null;
  };
}

export interface UseInfinitePaginationOptions<TData, TVariables extends Record<string, unknown>, TItem> {
  /** Typed document node do codegen sinh (client-preset). */
  query: TypedDocumentNode<TData, TVariables>;
  /**
   * Biến của query, KHÔNG kể `after` — hook tự bơm `after` từ `endCursor` mỗi
   * lần `loadMore()`.
   */
  variables: Omit<TVariables, 'after'>;
  /**
   * Trỏ tới trường chứa PaginatedXxx bên trong `data` (ví dụ: `data.exploreFeed`,
   * `data.pinComments`). Tách rời để hook không đoán tên field.
   */
  pickPage: (data: TData) => PaginatedShape<TItem> | null | undefined;
  /**
   * Ghép trang mới vào cache. Trả về `TData` mới (immutable) — Apollo cache
   * sẽ nhận nguyên object này. Thường: `{ ...prev, key: { items: [...prev.key.items, ...next.key.items], pageInfo: next.key.pageInfo } }`.
   */
  merge: (previous: TData, incoming: TData) => TData;
  /** Bỏ qua request đầu tiên (ví dụ: chưa đăng nhập, chưa có param). */
  skip?: boolean;
}

export interface UseInfinitePaginationResult<TItem, TData = unknown> {
  items: TItem[];
  hasNextPage: boolean;
  endCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
  loadMore: () => Promise<void>;
  refetch: () => Promise<unknown>;
  /**
   * Raw data từ Apollo. Chỉ dùng khi cần đọc field NGOÀI PaginatedShape (ví dụ
   * `HomeFeed.source`). Đừng dùng để đọc `items` — dùng field `items` của
   * chính kết quả này thì đã gộp qua các trang.
   */
  data: TData | undefined;
}

export function useInfinitePagination<
  TData,
  TVariables extends Record<string, unknown>,
  TItem,
>(
  options: UseInfinitePaginationOptions<TData, TVariables, TItem>,
): UseInfinitePaginationResult<TItem, TData> {
  const { query, variables, pickPage, merge, skip } = options;

  // Cast: `variables` bên ngoài là Omit<..., 'after'>; ở lời gọi đầu tiên,
  // `after` mặc định = null/undefined, backend hiểu là trang đầu.
  const { data, loading, error, fetchMore, refetch } = useQuery(query, {
    variables: variables as unknown as TVariables,
    skip,
    notifyOnNetworkStatusChange: true,
  });

  const page = data ? pickPage(data) : null;
  const items: TItem[] = page?.items ?? [];
  const hasNextPage = page?.pageInfo.hasNextPage ?? false;
  const endCursor = page?.pageInfo.endCursor ?? null;

  const [loadingMore, setLoadingMore] = useState(false);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasNextPage || !endCursor) return;
    setLoadingMore(true);
    try {
      await fetchMore({
        variables: { ...variables, after: endCursor } as unknown as TVariables,
        updateQuery: (previous, { fetchMoreResult }) =>
          merge(previous as TData, fetchMoreResult as TData),
      });
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasNextPage, endCursor, fetchMore, variables, merge]);

  return {
    items,
    hasNextPage,
    endCursor,
    loading,
    loadingMore,
    error,
    loadMore,
    refetch: refetch as unknown as () => Promise<unknown>,
    data: data as TData | undefined,
  };
}
