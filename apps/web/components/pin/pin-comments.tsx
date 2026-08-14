'use client';

import { useState } from 'react';
import { usePinComments, useCommentReplies } from '@/lib/hooks/usePaginatedQuery';
import type { PinCommentsQuery, CommentRepliesQuery } from '@/lib/gql/graphql';

/**
 * FE-4 §4.5 — Cây bình luận 2 tầng, chỉ ĐỌC.
 *
 * `pinComments(pinId)` chỉ trả comment gốc (bẫy 2 của PLAN_FRONTEND.md §4).
 * Reply gọi RIÊNG qua `commentReplies(commentId)`. Không có tầng thứ ba —
 * giới hạn cứng của backend, không phải thiếu sót.
 *
 * Đợt này KHÔNG dựng nút GỬI trả lời (mutation) — chỉ nút "Xem N trả lời" để
 * expand tầng 2. Nút "Trả lời" trong mockup được giữ HÌNH nhưng không nối
 * mutation, theo tiền lệ PinCard nút Lưu ở FE-3.
 *
 * `replyCount` từ backend đã tính chính xác (P1 Đợt 4 loader `replyCountByCommentIdLoader`).
 */

type Variant = 'modal' | 'page';

type Props = {
  pinId: string;
  variant: Variant;
};

export function PinComments({ pinId, variant }: Props) {
  const isModal = variant === 'modal';
  const { items, loading, loadingMore, hasNextPage, loadMore } = usePinComments({ pinId });

  if (loading && items.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>Đang tải bình luận…</div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>
        Chưa có bình luận nào.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isModal ? 13 : 14 }}>
      {items.map((c) => (
        <CommentRow key={c.id} comment={c} variant={variant} />
      ))}
      {hasNextPage && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          style={{
            background: 'none',
            border: 'none',
            padding: '4px 0',
            cursor: loadingMore ? 'default' : 'pointer',
            color: 'var(--color-primary-strong)',
            fontSize: 12.5,
            fontWeight: 700,
            alignSelf: 'flex-start',
          }}
        >
          {loadingMore ? 'Đang tải…' : 'Xem thêm bình luận'}
        </button>
      )}
      {variant === 'page' && (
        <div
          style={{
            display: 'flex',
            gap: 9,
            marginTop: 16,
          }}
        >
          <input
            placeholder="Bình luận công khai"
            disabled
            aria-label="Bình luận (chưa mở ở đợt này)"
            title="Ô soạn bình luận sẽ mở khi màn đăng nhập (FE-5) sẵn sàng"
            style={{
              flex: 1,
              padding: '11px 15px',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface-muted)',
              color: 'var(--color-muted)',
              fontSize: 13.5,
              outline: 'none',
              cursor: 'not-allowed',
            }}
          />
          <button
            type="button"
            disabled
            title="Gửi bình luận sẽ nối ở đợt sau"
            style={{
              padding: '11px 18px',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background: 'var(--color-primary)',
              color: 'var(--color-primary-foreground)',
              fontWeight: 700,
              fontSize: 13.5,
              cursor: 'not-allowed',
              opacity: 0.6,
            }}
          >
            Gửi
          </button>
        </div>
      )}
      {variant === 'page' && (
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--color-muted)',
            marginTop: 4,
          }}
        >
          Bình luận chỉ 2 tầng — không trả lời vào một trả lời.
        </div>
      )}
    </div>
  );
}

type CommentItem = PinCommentsQuery['pinComments']['items'][number];
type ReplyItem = CommentRepliesQuery['commentReplies']['items'][number];

function initialOf(name?: string | null, username?: string | null): string {
  const source = (name || username || '?').trim();
  return source.charAt(0).toUpperCase() || '?';
}

function CommentRow({ comment, variant }: { comment: CommentItem; variant: Variant }) {
  const isModal = variant === 'modal';
  const [showReplies, setShowReplies] = useState(false);
  const user = comment.user ?? null;
  const authorName = user?.name || user?.username || 'Người dùng';
  const replyCount = comment.replyCount ?? 0;
  const avatarSize = isModal ? 28 : 30;
  const textSize = isModal ? 13 : 13.5;
  const metaSize = isModal ? 11 : 11.5;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10 }}>
        {user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: '50%',
              objectFit: 'cover',
              flex: 'none',
            }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: '50%',
              background: 'var(--color-surface-muted)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: isModal ? 11.5 : 12,
              flex: 'none',
            }}
          >
            {initialOf(user?.name, user?.username)}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: textSize,
              lineHeight: 1.5,
              color: 'var(--color-foreground)',
            }}
          >
            <b>{authorName}</b> {comment.content}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: isModal ? 9 : 10,
              marginTop: isModal ? 4 : 5,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: metaSize, color: 'var(--color-muted)' }}>
              {formatRelative(comment.createdAt)}
            </div>
            <button
              type="button"
              disabled
              title="Gửi trả lời sẽ nối ở đợt sau"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'not-allowed',
                fontSize: metaSize,
                fontWeight: 700,
                color: 'var(--color-muted)',
                opacity: 0.75,
              }}
            >
              Trả lời
            </button>
            {replyCount > 0 && (
              <button
                type="button"
                onClick={() => setShowReplies((s) => !s)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: metaSize,
                  fontWeight: 700,
                  color: 'var(--color-primary-strong)',
                }}
              >
                {showReplies ? 'Ẩn trả lời' : `Xem ${replyCount} trả lời`}
              </button>
            )}
          </div>
          {showReplies && (
            <CommentRepliesList commentId={comment.id} variant={variant} />
          )}
        </div>
      </div>
    </div>
  );
}

function CommentRepliesList({ commentId, variant }: { commentId: string; variant: Variant }) {
  const isModal = variant === 'modal';
  const { items, loading, loadingMore, hasNextPage, loadMore } = useCommentReplies({
    commentId,
  });
  const textSize = isModal ? 12.5 : 13;
  const metaSize = isModal ? 11 : 11.5;
  const avatarSize = isModal ? 24 : 26;

  if (loading && items.length === 0) {
    return (
      <div
        style={{
          marginTop: 10,
          marginLeft: isModal ? 0 : 4,
          fontSize: textSize,
          color: 'var(--color-muted)',
        }}
      >
        Đang tải trả lời…
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        paddingLeft: 4,
        borderLeft: '2px solid var(--color-border)',
        marginLeft: 4,
      }}
    >
      {items.map((r: ReplyItem) => {
        const ru = r.user ?? null;
        const author = ru?.name || ru?.username || 'Người dùng';
        return (
          <div key={r.id} style={{ display: 'flex', gap: 8, paddingLeft: 10 }}>
            {ru?.avatarUrl ? (
              <img
                src={ru.avatarUrl}
                alt=""
                style={{
                  width: avatarSize,
                  height: avatarSize,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  flex: 'none',
                }}
              />
            ) : (
              <div
                aria-hidden
                style={{
                  width: avatarSize,
                  height: avatarSize,
                  borderRadius: '50%',
                  background: 'var(--color-surface-muted)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 11,
                  flex: 'none',
                }}
              >
                {initialOf(ru?.name, ru?.username)}
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: textSize,
                  lineHeight: 1.5,
                  color: 'var(--color-foreground)',
                }}
              >
                <b>{author}</b> {r.content}
              </div>
              <div
                style={{
                  fontSize: metaSize,
                  color: 'var(--color-muted)',
                  marginTop: 3,
                }}
              >
                {formatRelative(r.createdAt)}
              </div>
            </div>
          </div>
        );
      })}
      {hasNextPage && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            paddingLeft: 10,
            cursor: loadingMore ? 'default' : 'pointer',
            fontSize: metaSize,
            fontWeight: 700,
            color: 'var(--color-primary-strong)',
            alignSelf: 'flex-start',
          }}
        >
          {loadingMore ? 'Đang tải…' : 'Xem thêm trả lời'}
        </button>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} tháng`;
  return `${Math.floor(mo / 12)} năm`;
}
