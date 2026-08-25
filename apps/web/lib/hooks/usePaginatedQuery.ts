'use client';

import { useCallback } from 'react';
import {
  useInfinitePagination,
  type PaginatedShape,
  type UseInfinitePaginationResult,
} from './useInfinitePagination';

/*
 * QUAN TRỌNG: import từ `@/lib/gql/graphql` chứ KHÔNG phải `@/lib/gql`.
 * `lib/gql/index.ts` do codegen (client-preset) sinh ra và bị GHI ĐÈ mỗi
 * lần `pnpm codegen` chạy; nó chỉ re-export `./gql` (hàm graphql template
 * literal), không re-export `./graphql` (Document + Query types). Trỏ trực
 * tiếp vào `./graphql` là mặt cắt ổn định.
 */
import {
  ExploreFeedDocument,
  type ExploreFeedQuery,
  type ExploreFeedQueryVariables,
  UserPinsDocument,
  type UserPinsQuery,
  type UserPinsQueryVariables,
  ArchivedPinsDocument,
  type ArchivedPinsQuery,
  type ArchivedPinsQueryVariables,
  HomeFeedDocument,
  type HomeFeedQuery,
  type HomeFeedQueryVariables,
  NotificationsDocument,
  type NotificationsQuery,
  type NotificationsQueryVariables,
  FollowersDocument,
  type FollowersQuery,
  type FollowersQueryVariables,
  FollowingDocument,
  type FollowingQuery,
  type FollowingQueryVariables,
  UserBoardsDocument,
  type UserBoardsQuery,
  type UserBoardsQueryVariables,
  BlockedUsersDocument,
  type BlockedUsersQuery,
  type BlockedUsersQueryVariables,
  BoardPinsDocument,
  type BoardPinsQuery,
  type BoardPinsQueryVariables,
  SavedPinsDocument,
  type SavedPinsQuery,
  type SavedPinsQueryVariables,
  PinCommentsDocument,
  type PinCommentsQuery,
  type PinCommentsQueryVariables,
  CommentRepliesDocument,
  type CommentRepliesQuery,
  type CommentRepliesQueryVariables,
  ConversationsDocument,
  type ConversationsQuery,
  type ConversationsQueryVariables,
  MessagesDocument,
  type MessagesQuery,
  type MessagesQueryVariables,
  SearchPinsDocument,
  type SearchPinsQuery,
  type SearchPinsQueryVariables,
  SearchUsersDocument,
  type SearchUsersQuery,
  type SearchUsersQueryVariables,
  SearchBoardsDocument,
  type SearchBoardsQuery,
  type SearchBoardsQueryVariables,
} from '@/lib/gql/graphql';

/**
 * FE-0b — 15 hook typed bọc `useInfinitePagination`, một hook cho một query
 * phân trang. Mỗi hook chỉ điền: `query`, `pickPage`, `merge`.
 *
 * Vì sao 15 hook mỏng thay vì 1 hook generic được dùng trực tiếp:
 *   - Màn hình không cần nghĩ về `pickPage` / `merge`; chỉ gọi useExploreFeed()
 *     và nhận `items: Pin[]`. Ép logic đó ra 1 lần ở đây là kỷ luật.
 *   - `search` phải chia 3 hook riêng cho pins/users/boards vì backend chỉ điền
 *     1 field mỗi response tuỳ `type` (đã kiểm ở SDL — SearchResponse có 3
 *     field nullable). Gộp thì `pickPage` phải union → mọi màn phải typeguard.
 *
 * ⚠️ Nếu bạn thấy mình sắp viết `useInfinitePagination` trực tiếp trong màn:
 *     dừng lại và thêm hook mỏng ở đây. Bẫy chính là quên gắn field
 *     viewer-aware (isSavedByViewer, viewerReaction…) — hook mỏng cột chặt
 *     document, không có chỗ cho màn tự chọn field.
 */

// ------- Home / Explore feeds -------

export function useExploreFeed(
  variables: Omit<ExploreFeedQueryVariables, 'after'> = {},
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<ExploreFeedQuery['exploreFeed']['items'][number]> {
  const merge = useCallback(
    (previous: ExploreFeedQuery, incoming: ExploreFeedQuery): ExploreFeedQuery => ({
      ...previous,
      exploreFeed: {
        ...incoming.exploreFeed,
        items: [...previous.exploreFeed.items, ...incoming.exploreFeed.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    ExploreFeedQuery,
    ExploreFeedQueryVariables,
    ExploreFeedQuery['exploreFeed']['items'][number]
  >({
    query: ExploreFeedDocument,
    variables,
    pickPage: (d) => d.exploreFeed as PaginatedShape<ExploreFeedQuery['exploreFeed']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

export function useHomeFeed(
  variables: Omit<HomeFeedQueryVariables, 'after'> = {},
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<
  HomeFeedQuery['homeFeed']['items'][number],
  HomeFeedQuery
> & {
  source: HomeFeedQuery['homeFeed']['source'] | null;
} {
  const merge = useCallback(
    (previous: HomeFeedQuery, incoming: HomeFeedQuery): HomeFeedQuery => ({
      ...previous,
      homeFeed: {
        ...incoming.homeFeed,
        items: [...previous.homeFeed.items, ...incoming.homeFeed.items],
      },
    }),
    [],
  );
  const base = useInfinitePagination<
    HomeFeedQuery,
    HomeFeedQueryVariables,
    HomeFeedQuery['homeFeed']['items'][number]
  >({
    query: HomeFeedDocument,
    variables,
    pickPage: (d) =>
      d.homeFeed as unknown as PaginatedShape<HomeFeedQuery['homeFeed']['items'][number]>,
    merge,
    skip: opts.skip,
  });
  return { ...base, source: base.data?.homeFeed.source ?? null };
}

export function useUserPins(
  variables: Omit<UserPinsQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<UserPinsQuery['userPins']['items'][number]> {
  const merge = useCallback(
    (previous: UserPinsQuery, incoming: UserPinsQuery): UserPinsQuery => ({
      ...previous,
      userPins: {
        ...incoming.userPins,
        items: [...previous.userPins.items, ...incoming.userPins.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    UserPinsQuery,
    UserPinsQueryVariables,
    UserPinsQuery['userPins']['items'][number]
  >({
    query: UserPinsDocument,
    variables,
    pickPage: (d) =>
      d.userPins as PaginatedShape<UserPinsQuery['userPins']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

/**
 * F2 · XH-10 — KHO của chính người gọi (pin đã hết hạn).
 *
 * KHÔNG có `userId`: backend gắn `GqlAuthGuard` và lọc cứng `creatorId =
 * viewer`, nên kho của người khác là một khái niệm không tồn tại ở tầng hợp
 * đồng. Màn gọi phải tự chặn bằng `isSelf` TRƯỚC khi bật hook (`skip`), nếu
 * không người xem hồ sơ người khác sẽ bắn một request 401/rỗng vô nghĩa.
 *
 * Thứ tự trả về là keyset `(createdAt, id) DESC` — nhóm-theo-tháng ở màn kho
 * dựa vào tính đơn điệu đó để mỗi tiêu đề tháng chỉ xuất hiện một lần qua
 * nhiều trang. Sort lại ở client là phá luôn tính chất ấy.
 */
export function useArchivedPins(
  variables: Omit<ArchivedPinsQueryVariables, 'after'> = {},
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<ArchivedPinsQuery['archivedPins']['items'][number]> {
  const merge = useCallback(
    (previous: ArchivedPinsQuery, incoming: ArchivedPinsQuery): ArchivedPinsQuery => ({
      ...previous,
      archivedPins: {
        ...incoming.archivedPins,
        items: [...previous.archivedPins.items, ...incoming.archivedPins.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    ArchivedPinsQuery,
    ArchivedPinsQueryVariables,
    ArchivedPinsQuery['archivedPins']['items'][number]
  >({
    query: ArchivedPinsDocument,
    variables,
    pickPage: (d) =>
      d.archivedPins as PaginatedShape<ArchivedPinsQuery['archivedPins']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

// ------- Notifications -------

export function useNotifications(
  variables: Omit<NotificationsQueryVariables, 'after'> = {},
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<NotificationsQuery['notifications']['items'][number]> {
  const merge = useCallback(
    (previous: NotificationsQuery, incoming: NotificationsQuery): NotificationsQuery => ({
      ...previous,
      notifications: {
        ...incoming.notifications,
        items: [...previous.notifications.items, ...incoming.notifications.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    NotificationsQuery,
    NotificationsQueryVariables,
    NotificationsQuery['notifications']['items'][number]
  >({
    query: NotificationsDocument,
    variables,
    pickPage: (d) =>
      d.notifications as PaginatedShape<NotificationsQuery['notifications']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

// ------- Followers / Following -------

export function useFollowers(
  variables: Omit<FollowersQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<FollowersQuery['followers']['items'][number]> {
  const merge = useCallback(
    (previous: FollowersQuery, incoming: FollowersQuery): FollowersQuery => ({
      ...previous,
      followers: {
        ...incoming.followers,
        items: [...previous.followers.items, ...incoming.followers.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    FollowersQuery,
    FollowersQueryVariables,
    FollowersQuery['followers']['items'][number]
  >({
    query: FollowersDocument,
    variables,
    pickPage: (d) =>
      d.followers as PaginatedShape<FollowersQuery['followers']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

export function useFollowing(
  variables: Omit<FollowingQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<FollowingQuery['following']['items'][number]> {
  const merge = useCallback(
    (previous: FollowingQuery, incoming: FollowingQuery): FollowingQuery => ({
      ...previous,
      following: {
        ...incoming.following,
        items: [...previous.following.items, ...incoming.following.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    FollowingQuery,
    FollowingQueryVariables,
    FollowingQuery['following']['items'][number]
  >({
    query: FollowingDocument,
    variables,
    pickPage: (d) =>
      d.following as PaginatedShape<FollowingQuery['following']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

// ------- Blocked users (C2b) -------

export function useBlockedUsers(
  variables: Omit<BlockedUsersQueryVariables, 'after'> = {},
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<BlockedUsersQuery['blockedUsers']['items'][number]> {
  const merge = useCallback(
    (previous: BlockedUsersQuery, incoming: BlockedUsersQuery): BlockedUsersQuery => ({
      ...previous,
      blockedUsers: {
        ...incoming.blockedUsers,
        items: [...previous.blockedUsers.items, ...incoming.blockedUsers.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    BlockedUsersQuery,
    BlockedUsersQueryVariables,
    BlockedUsersQuery['blockedUsers']['items'][number]
  >({
    query: BlockedUsersDocument,
    variables,
    pickPage: (d) =>
      d.blockedUsers as PaginatedShape<BlockedUsersQuery['blockedUsers']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

// ------- Boards -------

export function useUserBoards(
  variables: Omit<UserBoardsQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<UserBoardsQuery['userBoards']['items'][number]> {
  const merge = useCallback(
    (previous: UserBoardsQuery, incoming: UserBoardsQuery): UserBoardsQuery => ({
      ...previous,
      userBoards: {
        ...incoming.userBoards,
        items: [...previous.userBoards.items, ...incoming.userBoards.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    UserBoardsQuery,
    UserBoardsQueryVariables,
    UserBoardsQuery['userBoards']['items'][number]
  >({
    query: UserBoardsDocument,
    variables,
    pickPage: (d) =>
      d.userBoards as PaginatedShape<UserBoardsQuery['userBoards']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

export function useBoardPins(
  variables: Omit<BoardPinsQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<BoardPinsQuery['boardPins']['items'][number]> {
  const merge = useCallback(
    (previous: BoardPinsQuery, incoming: BoardPinsQuery): BoardPinsQuery => ({
      ...previous,
      boardPins: {
        ...incoming.boardPins,
        items: [...previous.boardPins.items, ...incoming.boardPins.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    BoardPinsQuery,
    BoardPinsQueryVariables,
    BoardPinsQuery['boardPins']['items'][number]
  >({
    query: BoardPinsDocument,
    variables,
    pickPage: (d) =>
      d.boardPins as PaginatedShape<BoardPinsQuery['boardPins']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

/**
 * REVIEW-1 (#7) — pin ĐÃ LƯU của một người dùng (tab "Đã lưu" ở trang cá nhân).
 *
 * ⚠️ Server KHÔNG dedupe: một pin lưu vào N board trả về N dòng `SavedPin`
 * (`@@unique([userId, pinId, boardId])`). Nơi hiển thị phải gộp theo `pin.id`
 * trước khi đổ vào lưới, nếu không cùng một pin hiện nhiều lần.
 */
export function useSavedPins(
  variables: Omit<SavedPinsQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<SavedPinsQuery['savedPins']['items'][number]> {
  const merge = useCallback(
    (previous: SavedPinsQuery, incoming: SavedPinsQuery): SavedPinsQuery => ({
      ...previous,
      savedPins: {
        ...incoming.savedPins,
        items: [...previous.savedPins.items, ...incoming.savedPins.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    SavedPinsQuery,
    SavedPinsQueryVariables,
    SavedPinsQuery['savedPins']['items'][number]
  >({
    query: SavedPinsDocument,
    variables,
    pickPage: (d) =>
      d.savedPins as PaginatedShape<SavedPinsQuery['savedPins']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

// ------- Comments -------

export function usePinComments(
  variables: Omit<PinCommentsQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<PinCommentsQuery['pinComments']['items'][number]> {
  const merge = useCallback(
    (previous: PinCommentsQuery, incoming: PinCommentsQuery): PinCommentsQuery => ({
      ...previous,
      pinComments: {
        ...incoming.pinComments,
        items: [...previous.pinComments.items, ...incoming.pinComments.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    PinCommentsQuery,
    PinCommentsQueryVariables,
    PinCommentsQuery['pinComments']['items'][number]
  >({
    query: PinCommentsDocument,
    variables,
    pickPage: (d) =>
      d.pinComments as PaginatedShape<PinCommentsQuery['pinComments']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

export function useCommentReplies(
  variables: Omit<CommentRepliesQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<CommentRepliesQuery['commentReplies']['items'][number]> {
  const merge = useCallback(
    (previous: CommentRepliesQuery, incoming: CommentRepliesQuery): CommentRepliesQuery => ({
      ...previous,
      commentReplies: {
        ...incoming.commentReplies,
        items: [...previous.commentReplies.items, ...incoming.commentReplies.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    CommentRepliesQuery,
    CommentRepliesQueryVariables,
    CommentRepliesQuery['commentReplies']['items'][number]
  >({
    query: CommentRepliesDocument,
    variables,
    pickPage: (d) =>
      d.commentReplies as PaginatedShape<CommentRepliesQuery['commentReplies']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

// ------- Messaging -------

export function useConversations(
  variables: Omit<ConversationsQueryVariables, 'after'> = {},
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<ConversationsQuery['conversations']['items'][number]> {
  const merge = useCallback(
    (previous: ConversationsQuery, incoming: ConversationsQuery): ConversationsQuery => ({
      ...previous,
      conversations: {
        ...incoming.conversations,
        items: [...previous.conversations.items, ...incoming.conversations.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    ConversationsQuery,
    ConversationsQueryVariables,
    ConversationsQuery['conversations']['items'][number]
  >({
    query: ConversationsDocument,
    variables,
    pickPage: (d) =>
      d.conversations as PaginatedShape<ConversationsQuery['conversations']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

export function useMessages(
  variables: Omit<MessagesQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<MessagesQuery['messages']['items'][number]> {
  const merge = useCallback(
    (previous: MessagesQuery, incoming: MessagesQuery): MessagesQuery => ({
      ...previous,
      messages: {
        ...incoming.messages,
        items: [...previous.messages.items, ...incoming.messages.items],
      },
    }),
    [],
  );
  return useInfinitePagination<
    MessagesQuery,
    MessagesQueryVariables,
    MessagesQuery['messages']['items'][number]
  >({
    query: MessagesDocument,
    variables,
    pickPage: (d) =>
      d.messages as PaginatedShape<MessagesQuery['messages']['items'][number]>,
    merge,
    skip: opts.skip,
  });
}

// ------- Search (chia 3 hook, xem lý do ở đầu file) -------

type SearchPinItem = NonNullable<SearchPinsQuery['search']['pins']>['items'][number];
type SearchUserItem = NonNullable<SearchUsersQuery['search']['users']>['items'][number];
type SearchBoardItem = NonNullable<SearchBoardsQuery['search']['boards']>['items'][number];

export function useSearchPins(
  variables: Omit<SearchPinsQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<SearchPinItem> {
  const merge = useCallback(
    (previous: SearchPinsQuery, incoming: SearchPinsQuery): SearchPinsQuery => {
      const prevItems = previous.search.pins?.items ?? [];
      const nextItems = incoming.search.pins?.items ?? [];
      const nextPageInfo =
        incoming.search.pins?.pageInfo ??
        previous.search.pins?.pageInfo ?? { __typename: 'PageInfo' as const, hasNextPage: false, endCursor: null };
      return {
        ...previous,
        search: {
          ...previous.search,
          pins: {
            __typename: 'PaginatedPins' as const,
            items: [...prevItems, ...nextItems],
            pageInfo: nextPageInfo,
          },
        },
      };
    },
    [],
  );
  return useInfinitePagination<SearchPinsQuery, SearchPinsQueryVariables, SearchPinItem>({
    query: SearchPinsDocument,
    variables,
    pickPage: (d) => d.search.pins as PaginatedShape<SearchPinItem> | null | undefined,
    merge,
    skip: opts.skip,
  });
}

export function useSearchUsers(
  variables: Omit<SearchUsersQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<SearchUserItem> {
  const merge = useCallback(
    (previous: SearchUsersQuery, incoming: SearchUsersQuery): SearchUsersQuery => {
      const prevItems = previous.search.users?.items ?? [];
      const nextItems = incoming.search.users?.items ?? [];
      const nextPageInfo =
        incoming.search.users?.pageInfo ??
        previous.search.users?.pageInfo ?? { __typename: 'PageInfo' as const, hasNextPage: false, endCursor: null };
      return {
        ...previous,
        search: {
          ...previous.search,
          users: {
            __typename: 'PaginatedUsers' as const,
            items: [...prevItems, ...nextItems],
            pageInfo: nextPageInfo,
          },
        },
      };
    },
    [],
  );
  return useInfinitePagination<SearchUsersQuery, SearchUsersQueryVariables, SearchUserItem>({
    query: SearchUsersDocument,
    variables,
    pickPage: (d) => d.search.users as PaginatedShape<SearchUserItem> | null | undefined,
    merge,
    skip: opts.skip,
  });
}

export function useSearchBoards(
  variables: Omit<SearchBoardsQueryVariables, 'after'>,
  opts: { skip?: boolean } = {},
): UseInfinitePaginationResult<SearchBoardItem> {
  const merge = useCallback(
    (previous: SearchBoardsQuery, incoming: SearchBoardsQuery): SearchBoardsQuery => {
      const prevItems = previous.search.boards?.items ?? [];
      const nextItems = incoming.search.boards?.items ?? [];
      const nextPageInfo =
        incoming.search.boards?.pageInfo ??
        previous.search.boards?.pageInfo ?? { __typename: 'PageInfo' as const, hasNextPage: false, endCursor: null };
      return {
        ...previous,
        search: {
          ...previous.search,
          boards: {
            __typename: 'PaginatedBoards' as const,
            items: [...prevItems, ...nextItems],
            pageInfo: nextPageInfo,
          },
        },
      };
    },
    [],
  );
  return useInfinitePagination<SearchBoardsQuery, SearchBoardsQueryVariables, SearchBoardItem>({
    query: SearchBoardsDocument,
    variables,
    pickPage: (d) => d.search.boards as PaginatedShape<SearchBoardItem> | null | undefined,
    merge,
    skip: opts.skip,
  });
}
