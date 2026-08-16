'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApolloClient, useMutation } from '@apollo/client/react';
import { useSession } from 'next-auth/react';
import {
  MarkAllNotificationsReadDocument,
  MarkNotificationReadDocument,
  NotificationsDocument,
  UnreadNotificationCountDocument,
} from '@/lib/gql/graphql';
import { useNotifications } from '@/lib/hooks/usePaginatedQuery';
import { NOTIF_PAGE_SIZE } from '@/components/shell/notification-subscriber';
import { useWsStatus } from '@/lib/apollo/ws-status';
import { useToast } from '@/components/ui/toast';
import { formatRelativeTime } from '@/lib/format';

/**
 * D2 — /notifications (FE-8). Auth bắt buộc (proxy chặn khách; skip query phòng hờ).
 *
 * 6 mẫu hiển thị — ĐỦ CẢ 6, không loại nào bỏ (brief §3.2). `Notification` mang
 * sẵn actor/pin/comment ⇒ không query thêm per-dòng. Avatar là chữ cái đầu của
 * actor (không icon riêng theo loại — đúng bản vẽ). Thumbnail chỉ ở 4 loại tham
 * chiếu pin (COMMENT/REPLY/SAVE/REACTION); FOLLOW/MENTION không có thumb.
 *
 * Realtime: subscription `notificationReceived` mount APP-WIDE ở Providers
 * (NotificationSubscriber) → cache tự cập nhật ⇒ trang này chỉ ĐỌC cache. Banner
 * "Đang kết nối lại…" đọc trạng thái socket qua useWsStatus.
 *
 * Câu mô tả đã nói rõ loại ⇒ BỎ token `· LOẠI` tiếng Anh của bản vẽ (QĐ user 16/08).
 */

const TYPE_TEXT: Record<string, string> = {
  FOLLOW: 'đã theo dõi bạn',
  COMMENT: 'đã bình luận về pin của bạn',
  REPLY: 'đã trả lời bình luận của bạn',
  SAVE: 'đã lưu pin của bạn',
  REACTION: 'đã thả cảm xúc về pin của bạn',
  MENTION: 'đã nhắc tới bạn',
};

const THUMB_TYPES = new Set(['COMMENT', 'REPLY', 'SAVE', 'REACTION']);

type NotifItem = ReturnType<typeof useNotifications>['items'][number];

export default function NotificationsPage() {
  const router = useRouter();
  const { status } = useSession();
  const client = useApolloClient();
  const toast = useToast();
  const ws = useWsStatus();

  const authed = status === 'authenticated';
  const { items, loading, error, loadingMore, hasNextPage, loadMore, refetch } = useNotifications(
    { first: NOTIF_PAGE_SIZE },
    { skip: !authed },
  );
  const [markReadM] = useMutation(MarkNotificationReadDocument);
  const [markAllM] = useMutation(MarkAllNotificationsReadDocument);

  // Phòng hờ: nếu proxy không chặn (khách lọt vào), đẩy về đăng nhập.
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?callbackUrl=/notifications');
    }
  }, [status, router]);

  // Banner hiện khi socket đang chật vật nối (connecting/closed), không phải khi
  // idle (chưa mở) hay connected.
  const showReconnect = authed && (ws === 'connecting' || ws === 'closed');

  function navTarget(n: NotifItem): string | null {
    if (n.type === 'FOLLOW') return n.actor?.username ? `/@${n.actor.username}` : null;
    if (n.pin) return `/pin/${n.pin.id}`;
    if (n.actor?.username) return `/@${n.actor.username}`;
    return null;
  }

  function openNotif(n: NotifItem) {
    if (!n.isRead) {
      // optimistic: đánh dấu đã đọc + giảm badge; mutation chạy nền.
      const id = client.cache.identify(n);
      if (id) client.cache.modify({ id, fields: { isRead: () => true } });
      client.cache.updateQuery({ query: UnreadNotificationCountDocument }, (prev) =>
        prev
          ? { unreadNotificationCount: Math.max(0, (prev.unreadNotificationCount ?? 0) - 1) }
          : prev,
      );
      void markReadM({ variables: { id: n.id } }).catch(() => {
        /* im lặng — badge/danh sách sẽ đúng lại ở lần fetch kế; không làm phiền user */
      });
    }
    const target = navTarget(n);
    if (target) router.push(target);
  }

  async function onMarkAll() {
    const hasUnread = items.some((n) => !n.isRead);
    if (!hasUnread) return;
    // optimistic: mọi dòng đang cache → đã đọc; badge = 0.
    client.cache.updateQuery(
      { query: NotificationsDocument, variables: { first: NOTIF_PAGE_SIZE } },
      (prev) =>
        prev
          ? {
              ...prev,
              notifications: {
                ...prev.notifications,
                items: prev.notifications.items.map((it) => ({ ...it, isRead: true })),
              },
            }
          : prev,
    );
    client.cache.writeQuery({
      query: UnreadNotificationCountDocument,
      data: { unreadNotificationCount: 0 },
    });
    try {
      await markAllM();
    } catch {
      toast({ message: 'Không đánh dấu được, thử lại sau.' });
      void refetch();
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 40px' }} data-screen="D2-notifications">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1
          style={{
            fontFamily: "'Varela Round', var(--font-be-vietnam-pro), sans-serif",
            fontSize: 24,
            margin: 0,
            color: 'var(--color-foreground)',
          }}
        >
          Thông báo
        </h1>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onMarkAll}
          style={{
            padding: '9px 16px',
            borderRadius: 999,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-foreground)',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Đánh dấu tất cả đã đọc
        </button>
      </div>

      {showReconnect && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderRadius: 12,
            background: 'var(--color-surface-muted)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-muted)',
            fontSize: 12.5,
            marginBottom: 14,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '2px solid var(--color-border)',
              borderTopColor: 'var(--color-primary-strong)',
              animation: 'pin-grid-spin 800ms linear infinite',
              display: 'inline-block',
            }}
          />
          Đang kết nối lại…
        </div>
      )}

      {error ? (
        <StateBlock title="Không tải được thông báo" subtitle="Kiểm tra mạng rồi thử lại." />
      ) : (loading || !authed) && items.length === 0 ? (
        <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-muted)', fontSize: 14 }}>
          Đang tải…
        </div>
      ) : items.length === 0 ? (
        <StateBlock
          title="Chưa có thông báo nào"
          subtitle="Khi có người theo dõi, lưu pin hoặc nhắc tới bạn, thông báo sẽ hiện ở đây."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((n) => (
            <NotifRow key={n.id} n={n} onOpen={() => openNotif(n)} />
          ))}
          {hasNextPage && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 12,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-muted)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {loadingMore ? 'Đang tải…' : 'Xem thêm'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NotifRow({ n, onOpen }: { n: NotifItem; onOpen: () => void }) {
  const actorName = n.actor?.name ?? n.actor?.username ?? 'Ai đó';
  const text = TYPE_TEXT[n.type] ?? '';
  const thumb = THUMB_TYPES.has(n.type) && n.pin ? (n.pin.thumbnailUrl ?? n.pin.imageUrl) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '13px 15px',
        borderRadius: 14,
        textAlign: 'left',
        cursor: 'pointer',
        border: n.isRead ? '1px solid var(--color-border)' : '1px solid var(--color-primary-strong)',
        background: n.isRead ? 'var(--color-surface)' : 'var(--color-primary-soft)',
      }}
    >
      <NotifAvatar name={actorName} url={n.actor?.avatarUrl} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--color-foreground)' }}>
          <b>{actorName}</b> {text}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--color-muted)', marginTop: 3 }}>
          {formatRelativeTime(n.createdAt)}
        </div>
      </div>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flex: 'none' }}
        />
      )}
      {!n.isRead && (
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

function NotifAvatar({ name, url }: { name?: string | null; url?: string | null }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt={name ?? ''}
        style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: 42,
        height: 42,
        borderRadius: '50%',
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        flex: 'none',
      }}
    >
      {initial}
    </div>
  );
}

function StateBlock({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div
      role="status"
      style={{
        padding: '48px 20px',
        textAlign: 'center',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 20,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-foreground)' }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6, lineHeight: 1.6 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
