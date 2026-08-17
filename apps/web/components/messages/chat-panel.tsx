'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApolloClient, useMutation, useSubscription } from '@apollo/client/react';
import {
  DeleteMessageDocument,
  MarkMessageReadDocument,
  MessageReceivedDocument,
  SendMessageDocument,
} from '@/lib/gql/graphql';
import { useMessages } from '@/lib/hooks/usePaginatedQuery';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { MessageBubble, type MessageItem } from './message-bubble';
import { insertMessage, markReadInCache, removeMessage, MSG_PAGE_SIZE } from './message-cache';

/**
 * D4 — khung chat (pane phải). Số đo từ `Panacea-v2.1.html` view `messages`:
 *   tiêu đề   đệm 14px 18px · 14.5px/700 · viền dưới
 *   thân      flex:1 · cuộn dọc · đệm 18 · khe 12 · nền --color-background
 *   composer  đệm 14px 18px · viền trên · khe 9
 *             📎 40×40 radius 12 · ô nhập radius 999 đệm 11/15 · nút Gửi radius 999
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  VÌ SAO SUBSCRIPTION MOUNT Ở ĐÂY, KHÔNG PHẢI APP-WIDE                    ║
 * ║  `messageReceived(conversationId)` CÓ THAM SỐ ⇒ nó nghe đúng một hội      ║
 * ║  thoại. `NotificationSubscriber` của FE-8 mount ở Providers vì chuông     ║
 * ║  phải sống trên mọi trang; ở đây ngược lại — đổi hội thoại là đổi         ║
 * ║  subscription. Apollo tự huỷ/tạo lại khi `variables.conversationId` đổi.  ║
 * ║                                                                          ║
 * ║  KHÔNG dựng cơ chế nối-lại thứ hai: tầng nối lại đã có từ FE-8            ║
 * ║  (`lib/apollo/client.ts` shouldRetry + retryAttempts:Infinity + backoff;  ║
 * ║  `provider.tsx` terminate() khi token xoay). Phép "treo tab 10 phút" của  ║
 * ║  đợt này chính là để nghiệm thu tầng đó — access token sống 15 phút.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function ChatPanel({
  conversationId,
  meId,
  title,
}: {
  conversationId: string;
  meId: string | null;
  /** Tên người kia — pane trái đã có sẵn dữ liệu, truyền xuống để khỏi thêm query. */
  title: string;
}) {
  const client = useApolloClient();
  const confirm = useConfirm();
  const toast = useToast();

  const { items, loading, error, hasNextPage, loadingMore, loadMore } = useMessages({
    conversationId,
    first: MSG_PAGE_SIZE,
  });

  /**
   * Tin đã thu hồi TRONG PHIÊN NÀY. Server xoá hẳn tin khỏi query `messages`
   * (lọc `deletedAt: null`) nên không có đường nào đọc lại trạng thái này từ
   * mạng — giữ ở state cục bộ, kèm bản sao của tin để còn vẽ được bong bóng
   * sau khi đã gỡ nó khỏi cache. F5 là mất, đúng hướng user chốt 17/08.
   */
  const [revoked, setRevoked] = useState<Map<string, MessageItem>>(new Map());
  // Bị backend từ chối lúc subscribe (không còn là thành viên) — trạng thái
  // riêng thứ ba của brief. Phải BẮT, không được để khung chat treo im lặng.
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendM] = useMutation(SendMessageDocument);
  const [markReadM] = useMutation(MarkMessageReadDocument);
  const [deleteM] = useMutation(DeleteMessageDocument);

  // Không cần effect dọn state khi đổi hội thoại: `MessagesView` truyền
  // `key={activeId}` nên đổi hội thoại là REMOUNT cả khung — `revoked`,
  // `subscribeError`, ô soạn và `requestedRef` đều sinh lại từ đầu.

  useSubscription(MessageReceivedDocument, {
    variables: { conversationId },
    onData: ({ client: c, data }) => {
      const incoming = data.data?.messageReceived;
      if (!incoming) return;
      insertMessage(c.cache, incoming);
    },
    // Backend từ chối người ngoài NGAY lúc subscribe (`assertConversationMember`
    // ném 403 trước khi mở iterator) — đo được: server trả frame `next` chứa
    // `errors: [{ message: "Not a member of this conversation" }]`, KHÔNG đóng
    // socket. Apollo chuyển frame chỉ-có-errors thành onError.
    onError: (err) => setSubscribeError(err.message),
  });

  /**
   * Danh sách để VẼ: server trả `createdAt DESC` (mới nhất đầu mảng) còn khung
   * chat đọc từ trên xuống theo thời gian ⇒ lật ngược. Tin đã thu hồi được ghép
   * lại vào đúng vị trí cũ của nó (nó đã bị gỡ khỏi cache).
   */
  const rows: MessageItem[] = useMemo(() => {
    const live = items.filter((m) => !revoked.has(m.id));
    const merged = [...live, ...revoked.values()];
    merged.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return merged;
  }, [items, revoked]);

  /**
   * Đánh dấu đã đọc: chỉ tin của NGƯỜI KIA và chưa đọc. Tin của chính mình cũng
   * được backend trả `true` nhưng không làm gì (messages.service.ts) ⇒ lọc ở đây
   * để không bắn mutation thừa mỗi lần mở hội thoại.
   *
   * `requestedRef` chặn bắn TRÙNG: effect phụ thuộc `items`, mà `items` đổi mỗi
   * lần cache đổi — kể cả do chính `markReadInCache` gây ra. Không có sổ ghi
   * "đã gửi rồi" thì mỗi tin chưa đọc bị bắn lại ở mọi lượt render xen giữa lúc
   * mutation đang bay. `markMessageRead` là idempotent nên đó không thành lỗi
   * dữ liệu, nhưng là một chuỗi request vô ích.
   */
  const requestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!meId) return;
    for (const m of items) {
      if (m.senderId === meId || m.readAt != null) continue;
      if (requestedRef.current.has(m.id)) continue;
      requestedRef.current.add(m.id);
      void markReadM({ variables: { messageId: m.id } })
        .then(() => markReadInCache(client.cache, m.id))
        .catch(() => {
          // Cho phép thử lại ở lượt sau — im lặng, không làm phiền người đang đọc.
          requestedRef.current.delete(m.id);
        });
    }
  }, [items, meId, markReadM, client]);

  // Cuộn xuống đáy khi mở hội thoại và mỗi khi có tin mới.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lastRowId = rows[rows.length - 1]?.id;
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId, lastRowId]);

  const onSend = useCallback(async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const res = await sendM({ variables: { input: { conversationId, content } } });
      const sent = res.data?.sendMessage;
      // Chèn tay: `sendMessage` không phải query nên Apollo không tự nhét vào
      // danh sách. Chống trùng nằm trong insertMessage — frame subscription của
      // chính tin này cũng sẽ tới (người gửi nằm trong memberIds).
      if (sent) insertMessage(client.cache, sent);
      setText('');
    } catch {
      toast({ message: 'Không gửi được. Thử lại nhé.' });
    } finally {
      setSending(false);
    }
  }, [text, sending, sendM, conversationId, client, toast]);

  const onRevoke = useCallback(
    async (m: MessageItem) => {
      const ok = await confirm({
        title: 'Thu hồi tin nhắn?',
        body: 'Tin nhắn sẽ biến mất với cả hai người.',
        yesLabel: 'Thu hồi',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteM({ variables: { messageId: m.id } });
        removeMessage(client.cache, conversationId, m.id);
        setRevoked((prev) => new Map(prev).set(m.id, { ...m, revokedLocally: true }));
      } catch {
        toast({ message: 'Không thu hồi được. Thử lại nhé.' });
      }
    },
    [confirm, deleteM, client, conversationId, toast],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--color-border)',
          fontWeight: 700,
          fontSize: 14.5,
          color: 'var(--color-foreground)',
        }}
      >
        {title}
      </div>

      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: 'var(--color-background)',
        }}
      >
        {subscribeError ? (
          <Centered text={translateSubscribeError(subscribeError)} />
        ) : error ? (
          <Centered text="Không tải được tin nhắn." />
        ) : loading && rows.length === 0 ? (
          <Centered text="Đang tải…" />
        ) : rows.length === 0 ? (
          <Centered text="Chưa có tin nhắn nào. Gửi lời chào đi." />
        ) : (
          <>
            {hasNextPage && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  alignSelf: 'center',
                  padding: '7px 16px',
                  borderRadius: 999,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-muted)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                {loadingMore ? 'Đang tải…' : 'Xem tin cũ hơn'}
              </button>
            )}
            {rows.map((m) => (
              <MessageBubble
                key={m.id}
                m={m}
                mine={m.senderId === meId}
                onRevoke={() => void onRevoke(m)}
              />
            ))}
          </>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 9,
          padding: '14px 18px',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        {/* 📎 Đính pin — bản vẽ có nút nhưng KHÔNG vẽ màn chọn pin nào. User chốt
            17/08: hoãn sang đợt sau, giữ nút đúng vị trí ở dạng vô hiệu. Tin
            CHỈ-PIN nhận từ người khác vẫn render đầy đủ (xem message-bubble). */}
        <button
          type="button"
          disabled
          title="Đính pin sẽ có ở bản sau"
          aria-label="Đính pin sẽ có ở bản sau"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface-muted)',
            color: 'var(--color-muted)',
            cursor: 'not-allowed',
            opacity: 0.6,
            flex: 'none',
          }}
        >
          📎
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          placeholder="Nhắn gì đó"
          disabled={!!subscribeError}
          style={{
            flex: 1,
            padding: '11px 15px',
            borderRadius: 999,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface-muted)',
            color: 'var(--color-foreground)',
            fontSize: 13.5,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => void onSend()}
          disabled={sending || !text.trim() || !!subscribeError}
          style={{
            padding: '11px 20px',
            borderRadius: 999,
            border: 'none',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
            fontWeight: 700,
            fontSize: 13.5,
            cursor: sending || !text.trim() ? 'not-allowed' : 'pointer',
            opacity: sending || !text.trim() ? 0.6 : 1,
          }}
        >
          Gửi
        </button>
      </div>
    </div>
  );
}

/**
 * Khuôn dịch lỗi cho messaging — mở riêng, không nhét vào `translateBoardError`
 * (chuỗi khác miền). Chuỗi gốc lấy nguyên văn từ backend, đã đo bằng request
 * thật 17/08.
 */
export function translateMessagingError(raw: string): string {
  if (/Mutual follow is required/i.test(raw)) return 'Tin nhắn chỉ mở khi hai người theo dõi nhau.';
  if (/block status/i.test(raw)) return 'Không mở được trò chuyện do đã chặn nhau.';
  if (/conversation with yourself/i.test(raw)) return 'Không thể tự nhắn cho chính mình.';
  if (/Not a member of this conversation/i.test(raw)) return 'Bạn không còn trong cuộc trò chuyện này.';
  if (/Can only delete your own messages/i.test(raw)) return 'Chỉ thu hồi được tin của chính bạn.';
  return 'Có lỗi xảy ra. Thử lại nhé.';
}

const translateSubscribeError = translateMessagingError;

function Centered({ text }: { text: string }) {
  return (
    <div
      role="status"
      style={{
        margin: 'auto',
        textAlign: 'center',
        color: 'var(--color-muted)',
        fontSize: 13.5,
        lineHeight: 1.6,
        padding: '0 20px',
      }}
    >
      {text}
    </div>
  );
}
