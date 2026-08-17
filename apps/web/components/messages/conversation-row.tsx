'use client';

import { useQuery } from '@apollo/client/react';
import { ConversationLastMessageDocument, type ConversationsQuery } from '@/lib/gql/graphql';

type Conversation = ConversationsQuery['conversations']['items'][number];

/**
 * Một dòng hội thoại ở pane trái (D3). Số đo chép từ `Panacea-v2.1.html`:
 *   dòng    đệm 12px 14px · khe 11 · viền dưới 1px · nền primary-soft khi đang mở
 *   avatar  40×40 tròn, nền primary + chữ primary-foreground, chữ cái đầu
 *   tên     13.5px / 600 · preview 12px muted, cắt 1 dòng bằng ellipsis
 *   chấm    8×8 primary-strong
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  VÌ SAO MỖI DÒNG TỰ GỌI MỘT QUERY (chuyện đáng ngờ, có lý do đo được)    ║
 * ║                                                                          ║
 * ║  Bản vẽ có dòng preview + chấm chưa đọc. API thì KHÔNG có đường nào lấy   ║
 * ║  được hai thứ đó từ query `conversations`:                               ║
 * ║    • `Conversation` không có `lastMessage`, không có `unreadCount`        ║
 * ║      (schema.graphql:239 — cả kiểu chỉ có id/createdAt/updatedAt/members/ ║
 * ║      messages);                                                          ║
 * ║    • field `messages` TRÊN `Conversation` luôn trả `null` — module        ║
 * ║      messages không có `@ResolveField` nào, và `getConversations` chỉ     ║
 * ║      `include: { members: { include: { user: true } } }`. Đo bằng request ║
 * ║      thật 17/08: chọn `messages { id }` trong `conversations` ⇒ null cho  ║
 * ║      cả 3 hội thoại.                                                     ║
 * ║                                                                          ║
 * ║  Hướng user chốt 17/08: mỗi dòng gọi `messages(first: 1)`. Trang 20 hội   ║
 * ║  thoại = 20 query mỗi query đúng 1 dòng — chấp nhận được, và Apollo gộp   ║
 * ║  chúng vào cùng một batch tick. Nợ kỹ thuật đã ghi: đề nghị Luồng 2 thêm  ║
 * ║  `lastMessage` + `unreadCount` vào `Conversation` thì bỏ hẳn chỗ này.     ║
 * ║                                                                          ║
 * ║  CHẤM CHƯA ĐỌC = "tin CUỐI chưa đọc và không phải mình gửi", không phải   ║
 * ║  số tin chưa đọc. Bản vẽ cũng chỉ có chấm chứ không có số ⇒ không hụt gì. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function ConversationRow({
  conversation,
  meId,
  active,
  onOpen,
}: {
  conversation: Conversation;
  meId: string | null;
  active: boolean;
  onOpen: () => void;
}) {
  const other = otherMember(conversation, meId);
  const name = other?.name ?? other?.username ?? 'Người dùng';

  const { data } = useQuery(ConversationLastMessageDocument, {
    variables: { conversationId: conversation.id },
  });
  const last = data?.messages.items[0];

  const preview = last ? previewText(last.content, last.attachedPinId) : '';
  const unread = !!last && last.senderId !== meId && last.readAt == null;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '12px 14px',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        border: 'none',
        borderBottom: '1px solid var(--color-border)',
        background: active ? 'var(--color-primary-soft)' : 'transparent',
        color: 'var(--color-foreground)',
      }}
    >
      <Avatar name={name} url={other?.avatarUrl} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{name}</div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {preview}
        </div>
      </div>
      {unread && (
        <span
          aria-label="Chưa đọc"
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: 'var(--color-primary-strong)',
            flex: 'none',
          }}
        />
      )}
    </button>
  );
}

/**
 * Người kia trong DM. Hội thoại luôn đúng 2 thành viên (`createConversation` chỉ
 * tạo cặp), nhưng vẫn viết dạng "member đầu tiên không phải tôi" để không vỡ nếu
 * sau này có nhóm. Fallback về member[0] cho trường hợp `meId` chưa nạp xong.
 */
export function otherMember(conversation: Conversation, meId: string | null) {
  const members = conversation.members ?? [];
  const found = members.find((m) => m.user?.id !== meId) ?? members[0];
  return found?.user ?? null;
}

/** Dòng preview: tin chỉ-pin không có chữ ⇒ hiện nhãn thay vì để trống. */
function previewText(content: string | null | undefined, attachedPinId: string | null | undefined): string {
  if (content) return content;
  if (attachedPinId) return 'Đã gửi một pin';
  return '';
}

export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--color-primary)',
        color: 'var(--color-primary-foreground)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        flex: 'none',
      }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}
