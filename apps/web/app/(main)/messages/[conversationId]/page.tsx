import { MessagesView } from '@/components/messages/messages-view';

/**
 * D3/D4 — `/messages/<conversationId>`. Hội thoại đang mở nằm trong đường dẫn
 * (bản vẽ dùng state cục bộ `s.conversationId`) để F5 không mất chỗ đang đọc và
 * để nút "Tin nhắn" ở hồ sơ C1b link thẳng vào được.
 *
 * `params` là Promise ở Next 16 — `params.conversationId` đọc thẳng sẽ cho
 * `undefined` mà KHÔNG báo lỗi (PLAN_FRONTEND §4 bẫy 6).
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <MessagesView activeId={conversationId} />;
}
