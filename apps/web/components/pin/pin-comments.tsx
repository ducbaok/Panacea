'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useMutation } from '@apollo/client/react';
import { usePinComments, useCommentReplies } from '@/lib/hooks/usePaginatedQuery';
import {
  CreateCommentDocument,
  type PinCommentsQuery,
  type CommentRepliesQuery,
} from '@/lib/gql/graphql';
import { useAuthPrompt } from '@/components/auth/auth-prompt';
import { useToast } from '@/components/ui/toast';

/**
 * FE-4 §4.5 — Cây bình luận 2 tầng. FE-11 nối GHI cho tầng 1.
 *
 * `pinComments(pinId)` chỉ trả comment gốc (bẫy 2 của PLAN_FRONTEND.md §4).
 * Reply gọi RIÊNG qua `commentReplies(commentId)`. Không có tầng thứ ba —
 * giới hạn cứng của backend (`comments.service.ts:56-58`), không phải thiếu sót.
 *
 * `replyCount` từ backend đã tính chính xác (P1 Đợt 4 loader `replyCountByCommentIdLoader`).
 *
 * ─── FE-11 (17/08/2026) — ĐỌC TRƯỚC KHI TIN COMMENT CŨ ───────────────────────
 * Bản FE-4 để ô soạn + nút Gửi + nút Trả lời ở trạng thái `disabled` với lý do
 * ghi thẳng vào `title`: *"sẽ mở khi màn đăng nhập (FE-5) sẵn sàng"*. **FE-5 xanh
 * 15/08** ⇒ lý do đó hết hạn 2 ngày mà không ai gỡ, và vì nó nằm trong `title`
 * chứ trong mục "còn treo" của một plan nào, tra tài liệu không ra. Đợt FE-11
 * quét toàn app mới lộ: `createComment`/`updateComment`/`deleteComment`/
 * `toggleCommentReaction` — **cả 4 mutation đều 0 nơi dùng**.
 *
 * Nay đã nối: **`createComment` cho bình luận GỐC** (ô soạn + nút Gửi).
 *
 * CÒN TREO, cố ý — cả ba đều CHỜ BẢN VẼ (luật 19), không phải quên:
 *   • **Trả lời** — nút có trong bản vẽ nhưng Ô NHẬP trả lời thì KHÔNG. Bấm nút
 *     thì soạn ở đâu? (inline dưới comment / focus ô chung / modal riêng) —
 *     `Panacea-v2.1.html` không trả lời câu đó. `parentId` của mutation đã sẵn
 *     sàng, chỉ thiếu bề mặt.
 *   • **Sửa / Xoá bình luận** — không có menu ⋯ nào được vẽ trên dòng bình luận.
 *   • **Cảm xúc trên bình luận** — `reactionCount`/`isReactedByViewer` được
 *     `CreateComment` chọn sẵn, nhưng không có nút nào được vẽ để bấm.
 */

type Variant = 'modal' | 'page';

type Props = {
  pinId: string;
  variant: Variant;
};

/** Giới hạn cứng của backend: `@MaxLength(1000)` ở `create-comment.input.ts:23`. */
const MAX_COMMENT_LENGTH = 1000;

export function PinComments({ pinId, variant }: Props) {
  const isModal = variant === 'modal';
  const { items, loading, loadingMore, hasNextPage, loadMore, refetch } = usePinComments({
    pinId,
  });
  const { status: sessionStatus } = useSession();
  const { openAuthPrompt } = useAuthPrompt();
  const toast = useToast();
  const [createComment] = useMutation(CreateCommentDocument);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX_COMMENT_LENGTH;
  const canSend = trimmed !== '' && !tooLong && !sending;

  /**
   * FE-11 — gửi bình luận GỐC (`parentId` bỏ trống). Khuôn `onSend` của
   * `chat-panel.tsx`: guard phiên → chặn bấm đôi → mutate → `refetch()` → xoá ô.
   *
   * Vì sao `refetch()` chứ không chèn thẳng vào cache: danh sách này đi qua
   * `useInfinitePagination` với hàm `merge` gộp-theo-trang của riêng nó; chèn tay
   * một item vào giữa cấu trúc đó sẽ lệch `pageInfo.endCursor` và làm "Xem thêm
   * bình luận" nhảy trang. Đọc lại trang đầu là đường an toàn.
   *
   * `MENTION` chạy ở backend: `comments.service.ts:89-111` parse `@username` và
   * tạo Notification thật (tối đa 10 mention/bình luận). Không cần FE làm gì —
   * nhưng đó là lý do gửi bình luận có thể sinh thông báo cho người thứ ba.
   */
  const onSend = async () => {
    if (sessionStatus !== 'authenticated') {
      openAuthPrompt('bình luận');
      return;
    }
    if (!canSend) return;
    setSending(true);
    try {
      await createComment({ variables: { input: { pinId, content: trimmed } } });
      await refetch();
      setText('');
    } catch {
      toast({ message: 'Không gửi được bình luận, thử lại sau.' });
    } finally {
      setSending(false);
    }
  };

  /**
   * Ô soạn CHỈ có ở bản trang (bản vẽ không vẽ nó trong modal — FE-4 §3.4 liệt nó
   * vào 4 khối chỉ-có-ở-page). Tách ra biến riêng vì nó phải xuất hiện ở CẢ hai
   * nhánh render: có bình luận và CHƯA có bình luận nào.
   */
  const composer =
    variant !== 'page' ? null : (
      <>
        <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder="Bình luận công khai"
            aria-label="Bình luận công khai"
            aria-invalid={tooLong || undefined}
            disabled={sending}
            style={{
              flex: 1,
              padding: '11px 15px',
              borderRadius: 'var(--radius-button)',
              border: tooLong ? '1px solid var(--color-danger)' : '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              fontSize: 13.5,
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => void onSend()}
            disabled={!canSend}
            style={{
              padding: '11px 18px',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background: 'var(--color-primary)',
              color: 'var(--color-primary-foreground)',
              fontWeight: 700,
              fontSize: 13.5,
              cursor: canSend ? 'pointer' : 'not-allowed',
              opacity: canSend ? 1 : 0.6,
            }}
          >
            {sending ? 'Đang gửi…' : 'Gửi'}
          </button>
        </div>
        {tooLong && (
          <div role="alert" style={{ fontSize: 11.5, color: 'var(--color-danger)', marginTop: 4 }}>
            Bình luận tối đa {MAX_COMMENT_LENGTH} ký tự.
          </div>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--color-muted)', marginTop: 4 }}>
          Bình luận chỉ 2 tầng — không trả lời vào một trả lời.
        </div>
      </>
    );

  if (loading && items.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>Đang tải bình luận…</div>
    );
  }

  /**
   * 🔴 Bug FE-11 tự lộ khi nối: bản cũ `return` ở nhánh rỗng TRƯỚC khi tới khối
   * composer, nên pin chưa có bình luận nào thì **không có ô soạn** — tức không
   * viết được bình luận ĐẦU TIÊN. Khi ô soạn còn `disabled` thì không ai thấy;
   * nối mutation vào là lộ ngay. Nhánh rỗng nay phải mang composer theo.
   */
  if (items.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>Chưa có bình luận nào.</div>
        {composer}
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
      {composer}
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
            {/*
              FE-11 — vẫn `disabled`, nhưng lý do đã đổi và phải ghi cho đúng:
              KHÔNG phải "chưa nối mutation" (mutation `createComment` có sẵn
              `parentId`, đã dùng ở ngay file này cho tầng 1). Thiếu là **bản vẽ
              ô nhập trả lời** — bấm nút này thì soạn ở đâu, bản vẽ không nói.
              Luật 19: không tự bịa. Đăng ký ở PLAN_FRONTEND.md §FE-11 "Còn treo".
            */}
            <button
              type="button"
              disabled
              title="Chờ bản vẽ ô nhập trả lời — xem PLAN_FRONTEND.md §FE-11"
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
