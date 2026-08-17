'use client';

import type { ApolloCache } from '@apollo/client';
import {
  ConversationLastMessageDocument,
  ConversationsDocument,
  MessagesDocument,
  type MessagesQuery,
} from '@/lib/gql/graphql';

/** Kích thước trang — dùng CHUNG giữa hook đọc và mọi chỗ ghi cache tay. */
export const MSG_PAGE_SIZE = 20;
export const CONV_PAGE_SIZE = 20;

type MessageNode = MessagesQuery['messages']['items'][number];

/**
 * Chèn một tin nhắn vào MỌI chỗ cache đang giữ nó, dùng chung bởi hai đường:
 *   • subscription `messageReceived` (tin của người kia — và của cả chính mình,
 *     vì server publish cho toàn bộ memberIds);
 *   • mutation `sendMessage` (tin của mình, về sớm hơn frame subscription).
 *
 * ⚠️ HAI ĐƯỜNG ẤY CÙNG BẮN CHO MỘT TIN. Người gửi nằm trong `memberIds` nên
 * nhận lại chính tin mình vừa gửi qua socket. Vì thế mọi nhánh dưới đây đều
 * CHỐNG TRÙNG THEO `id` — bỏ bước đó thì mỗi tin mình gửi hiện hai lần.
 *
 * `messages` sắp xếp `createdAt DESC` (tin mới nhất đứng ĐẦU mảng `items`) ⇒
 * chèn bằng `unshift`, không phải `push`. Việc lật ngược để vẽ (cũ trên, mới
 * dưới) làm ở tầng hiển thị.
 */
export function insertMessage(cache: ApolloCache, message: MessageNode): void {
  const conversationId = message.conversationId;

  // 1) Danh sách tin của khung chat đang mở.
  cache.updateQuery(
    { query: MessagesDocument, variables: { conversationId, first: MSG_PAGE_SIZE } },
    (prev) => {
      if (!prev) return prev;
      if (prev.messages.items.some((it) => it.id === message.id)) return prev;
      return {
        ...prev,
        messages: { ...prev.messages, items: [message, ...prev.messages.items] },
      };
    },
  );

  // 2) Dòng preview ở pane trái (query `messages(first: 1)` riêng của mỗi dòng).
  //    Ghi đè thẳng vì nó luôn chỉ giữ đúng tin cuối.
  cache.writeQuery({
    query: ConversationLastMessageDocument,
    variables: { conversationId },
    data: {
      messages: {
        __typename: 'PaginatedMessages' as const,
        items: [
          {
            __typename: 'Message' as const,
            id: message.id,
            content: message.content,
            attachedPinId: message.attachedPinId,
            senderId: message.senderId,
            readAt: message.readAt,
            createdAt: message.createdAt,
          },
        ],
      },
    },
  });

  // 3) Inbox sắp theo `updatedAt DESC`, và `sendMessage` có đụng `updatedAt` của
  //    Conversation ⇒ hội thoại vừa có tin phải nhảy lên đầu. Làm tay ở cache
  //    để không phải refetch cả danh sách sau mỗi tin.
  cache.updateQuery(
    { query: ConversationsDocument, variables: { first: CONV_PAGE_SIZE } },
    (prev) => {
      if (!prev) return prev;
      const idx = prev.conversations.items.findIndex((c) => c.id === conversationId);
      if (idx <= 0) return prev; // không có trong trang này, hoặc đã ở đầu rồi
      const items = [...prev.conversations.items];
      const [moved] = items.splice(idx, 1);
      return {
        ...prev,
        conversations: { ...prev.conversations, items: [moved, ...items] },
      };
    },
  );
}

/**
 * Gỡ một tin khỏi cache sau khi thu hồi.
 *
 * ⚠️ KHÔNG dùng `cache.evict` trên entity `Message`: nó xoá bản ghi chuẩn hoá
 * nhưng để lại con trỏ chết trong các danh sách đang trỏ tới, và Apollo sẽ đọc
 * ra `null` giữa mảng. Cắt khỏi từng danh sách rồi mới coi như xong.
 *
 * Bong bóng "Tin nhắn đã thu hồi" KHÔNG sinh ra ở đây — nó là state cục bộ của
 * khung chat (`revokedLocally`), vì server đã xoá hẳn tin khỏi mọi query.
 */
export function removeMessage(cache: ApolloCache, conversationId: string, messageId: string): void {
  cache.updateQuery(
    { query: MessagesDocument, variables: { conversationId, first: MSG_PAGE_SIZE } },
    (prev) =>
      prev
        ? {
            ...prev,
            messages: {
              ...prev.messages,
              items: prev.messages.items.filter((it) => it.id !== messageId),
            },
          }
        : prev,
  );
}

/** Đánh dấu `readAt` cho một tin đã ở trong cache (dùng sau `markMessageRead`). */
export function markReadInCache(cache: ApolloCache, messageId: string): void {
  const id = cache.identify({ __typename: 'Message', id: messageId });
  if (!id) return;
  cache.modify({ id, fields: { readAt: (prev) => prev ?? new Date().toISOString() } });
}
