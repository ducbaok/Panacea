'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@apollo/client/react';
import { useSession } from 'next-auth/react';
import { MeDocument } from '@/lib/gql/graphql';
import { useConversations } from '@/lib/hooks/usePaginatedQuery';
import { useWsStatus } from '@/lib/apollo/ws-status';
import { ChatPanel } from './chat-panel';
import { ConversationRow, otherMember } from './conversation-row';
import { CONV_PAGE_SIZE } from './message-cache';

/**
 * D3 + D4 — `/messages` (FE-9). Khung 2 pane, số đo từ `Panacea-v2.1.html`:
 *   khung   grid 280px minmax(0,1fr) · viền 1px · radius 20 · cao 600 · nền surface
 *   pane T  viền phải 1px · cuộn dọc · tiêu đề "Tin nhắn" đệm 16, 15px/700
 *
 * Hội thoại đang mở nằm trong ĐƯỜNG DẪN (`/messages/<id>`) chứ không phải state
 * cục bộ như bản vẽ (`s.conversationId`): như vậy F5 không mất chỗ đang đọc, và
 * nút "Tin nhắn" ở hồ sơ C1b link thẳng vào đúng hội thoại được.
 */
export function MessagesView({ activeId }: { activeId: string | null }) {
  const router = useRouter();
  const { status } = useSession();
  const ws = useWsStatus();
  const authed = status === 'authenticated';

  const { data: meData } = useQuery(MeDocument, { skip: !authed });
  const meId = meData?.me?.id ?? null;

  const { items, loading, error, hasNextPage, loadingMore, loadMore } = useConversations(
    { first: CONV_PAGE_SIZE },
    { skip: !authed },
  );

  // Phòng hờ: proxy.ts đã chặn khách, nhưng nếu lọt vào thì đẩy về đăng nhập
  // (đúng khuôn /notifications của FE-8).
  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login?callbackUrl=/messages');
  }, [status, router]);

  const active = activeId ? items.find((c) => c.id === activeId) : undefined;
  const activeTitle = active
    ? (() => {
        const u = otherMember(active, meId);
        return u?.name ?? u?.username ?? '';
      })()
    : '';

  const showReconnect = authed && (ws === 'connecting' || ws === 'closed');

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 16px 40px' }} data-screen="D3-D4-messages">
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

      {/* Bản vẽ chỉ có bản desktop (grid 280px + 1fr, cao 600). Dưới 768px không
          đủ chỗ cho 2 pane cạnh nhau ⇒ hiện đúng một pane: danh sách khi chưa
          chọn hội thoại, khung chat khi đã chọn. Đây là suy ra TỐI THIỂU để màn
          không vỡ (cùng kiểu `md:hidden` mà FE-8 dùng cho ô tìm kiếm mobile),
          không thêm quyết định thị giác mới nào. */}
      <div
        className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 20,
          overflow: 'hidden',
          background: 'var(--color-surface)',
          height: 600,
        }}
      >
        <div
          className={activeId ? 'hidden md:block' : 'block'}
          style={{ borderRight: '1px solid var(--color-border)', overflowY: 'auto' }}
        >
          <div
            style={{
              padding: 16,
              fontWeight: 700,
              fontSize: 15,
              borderBottom: '1px solid var(--color-border)',
              color: 'var(--color-foreground)',
            }}
          >
            Tin nhắn
          </div>

          {error ? (
            <PaneNote title="Không tải được danh sách trò chuyện." />
          ) : (loading || !authed) && items.length === 0 ? (
            <PaneNote title="Đang tải…" />
          ) : items.length === 0 ? (
            <PaneNote
              title="Chưa có cuộc trò chuyện nào."
              subtitle="Tin nhắn chỉ mở khi hai người theo dõi nhau."
            />
          ) : (
            <>
              {items.map((c) => (
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  meId={meId}
                  active={c.id === activeId}
                  onOpen={() => router.push(`/messages/${c.id}`)}
                />
              ))}
              {hasNextPage && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{
                    width: '100%',
                    padding: 12,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-muted)',
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  {loadingMore ? 'Đang tải…' : 'Xem thêm'}
                </button>
              )}
            </>
          )}
        </div>

        {activeId ? (
          // `key` ép dựng lại toàn bộ khung khi đổi hội thoại: state cục bộ (tin
          // đã thu hồi, lỗi subscribe, ô soạn) không được rò sang hội thoại khác.
          <ChatPanel key={activeId} conversationId={activeId} meId={meId} title={activeTitle} />
        ) : (
          // Mobile chưa chọn hội thoại thì danh sách đã chiếm cả khung ⇒ ẩn ô này.
          <div
            className="hidden md:flex"
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--color-background)',
              color: 'var(--color-muted)',
              fontSize: 13.5,
              padding: 20,
              textAlign: 'center',
            }}
          >
            Chọn một cuộc trò chuyện để bắt đầu.
          </div>
        )}
      </div>
    </div>
  );
}

function PaneNote({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div role="status" style={{ padding: '28px 18px', textAlign: 'center' }}>
      <div style={{ fontSize: 13.5, color: 'var(--color-foreground)', fontWeight: 600 }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 6, lineHeight: 1.6 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
