'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery } from '@apollo/client/react';
import { usePinComments, useCommentReplies } from '@/lib/hooks/usePaginatedQuery';
import {
  CreateCommentDocument,
  UpdateCommentDocument,
  DeleteCommentDocument,
  ToggleCommentReactionDocument,
  MeDocument,
  ReactionType,
  type MeQuery,
  type PinCommentsQuery,
  type CommentRepliesQuery,
} from '@/lib/gql/graphql';
import { useAuthPrompt } from '@/components/auth/auth-prompt';
import { UserLink } from '@/components/profile/user-link';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/lib/i18n/provider';
import type { TFunction, TranslationKey } from '@/lib/i18n/translate';

/**
 * FE-4 §4.5 — Cây bình luận 2 tầng. FE-11 nối GHI cho tầng 1; **DEBT-1b nối nốt
 * ba bề mặt còn lại** (trả lời · sửa/xoá · cảm xúc).
 *
 * `pinComments(pinId)` chỉ trả comment gốc (bẫy 2 của PLAN_FRONTEND.md §4).
 * Reply gọi RIÊNG qua `commentReplies(commentId)`. Không có tầng thứ ba —
 * giới hạn cứng của backend (`comments.service.ts:56-58`), không phải thiếu sót.
 *
 * `replyCount` từ backend đã tính chính xác (P1 Đợt 4 loader `replyCountByCommentIdLoader`).
 *
 * ─── DEBT-1b (17/08/2026) — 4 mutation nay ĐỦ NƠI DÙNG ───────────────────────
 * FE-11 quét ra cả 4 mutation bình luận đều **0 nơi dùng**, nối được 1
 * (`createComment` cho bình luận gốc) và để 3 bề mặt lại **chờ bản vẽ** — không
 * phải chờ code. User chốt bản vẽ 17/08, nên đợt này nối hết:
 *
 *   • **Trả lời** → ô nhập **inline ngay dưới bình luận đó** (✅① — không focus ô
 *     chung, không modal). **Một ô mở tại một thời điểm** trên toàn cây.
 *   • **Sửa / Xoá** → chép khuôn menu `⋯` của `pin-detail.tsx`, chỉ hiện khi
 *     `comment.user.id === me.id` (✅②).
 *   • **Cảm xúc** → **1 nút tim + số đếm**, KHÔNG 5 loại (✅③).
 *
 * ⚠️ **Vì sao 1 tim mà không 5 loại như hàng cảm xúc của pin:** `Comment` **không
 * trả về loại cảm xúc nào cả** — chỉ `reactionCount` (tổng của mọi người) và
 * `isReactedByViewer` (boolean). Dựng 5 nút thì người dùng chọn 💡, F5 xong thấy
 * ❤️, vì FE không có đường nào biết họ đã chọn gì. Muốn 5 loại phải thêm field ở
 * backend ⇒ v2, đừng tự mở.
 *
 * 🟢 **Nhờ B-19 (DEBT-1a) đợt này KHÔNG cần optimistic cho cảm xúc.**
 * `toggleCommentReaction` nay trả `Comment!` kèm `{ id reactionCount
 * isReactedByViewer }`, Apollo chuẩn hoá theo `id` ⇒ cả danh sách gốc lẫn cây
 * trả lời tự đúng. Chỉ còn một cờ `busy` chặn bấm đôi — cố ý không dựng nguồn
 * sự thật thứ hai ở client cho thứ server đã trả về.
 *
 * 🅰️ **KHÔNG hiện nhãn "đã sửa"** dù `updatedAt` có sẵn trong cả hai query:
 * bản vẽ không vẽ nó (luật 19). Thêm sau rẻ; đã vẽ rồi mà bỏ đi thì đắt.
 */

type Variant = 'modal' | 'page';

type Props = {
  pinId: string;
  variant: Variant;
};

/** Giới hạn cứng của backend: `@MaxLength(1000)` ở `create-comment.input.ts:23`. */
const MAX_COMMENT_LENGTH = 1000;

/**
 * Ô inline đang mở, DÙNG CHUNG cho cả trả lời và sửa.
 *
 * Một biến `{id, mode}` chứ không phải hai state riêng, và không phải boolean
 * mỗi hàng: bất biến *"đúng một ô mở tại một thời điểm"* nằm ngay trong hình
 * dạng dữ liệu. Hai state riêng sẽ cho phép trạng thái vô nghĩa "đang sửa
 * comment A trong lúc đang trả lời comment A".
 */
type OpenEditor = {
  id: string;
  mode: 'reply' | 'edit';
  /**
   * Chữ điền sẵn cho ô trả lời — REVIEW-1 (#9). Trả lời một TRẢ LỜI thì ô mở ra
   * ở comment gốc, nên nếu không nói rõ đang đáp ai thì người đọc mất dấu.
   */
  prefill?: string;
} | null;

/**
 * Thông điệp lỗi của backend khi cố trả lời vào một trả lời
 * (`comments.service.ts` — `Cannot reply to a reply`).
 *
 * REVIEW-1 (#9): UI nay CÓ nút "Trả lời" ở tầng 2, nhưng nó vẫn gửi
 * `parentId` = comment GỐC (kèm "@tên" trong nội dung), nên nhánh lỗi này vẫn
 * không chạm tới được. Giữ map làm lưới an toàn.
 */
const REPLY_TO_REPLY = /Cannot reply to a reply/i;

/**
 * Regex nhận diện mention — chép ĐÚNG biểu thức backend dùng để bắn thông báo
 * MENTION (`comments.service.ts`). Hai bên phải khớp nhau: chỗ nào FE tô đậm
 * mà backend không nhận ra thì người được nhắc không nhận được thông báo, và
 * ngược lại. Sửa một bên phải sửa cả bên kia.
 */
const MENTION_RE = /@([a-z0-9_]{3,20})/gi;

/**
 * Tô đậm các token `@username` trong nội dung bình luận (REVIEW-1 #9) và biến
 * chúng thành lối vào hồ sơ (26/08/2026).
 * Trả về mảng ReactNode để React tự escape — KHÔNG dùng dangerouslySetInnerHTML,
 * nội dung này do người dùng nhập.
 *
 * ⚠️ Token khớp regex KHÔNG bảo đảm là tài khoản có thật: người viết gõ tay
 * `@aikhongco` thì vẫn được tô đậm và vẫn thành liên kết, bấm vào ra 404 của
 * `[handle]`. Đây là đánh đổi CÓ CHỦ Ý, giống Twitter/Facebook: kiểm tra sự tồn
 * tại đòi một truy vấn cho mỗi token trên mỗi bình luận, mà cái giá của việc
 * đoán sai chỉ là một trang 404. Chỗ nhắc ĐÚNG người — đường đi thật của tính
 * năng — luôn ra hồ sơ đúng.
 */
function renderWithMentions(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  // `matchAll` cần cờ /g; regex là hằng module nên phải reset lastIndex —
  // biểu thức có /g giữ trạng thái giữa các lần gọi.
  MENTION_RE.lastIndex = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const at = m.index ?? 0;
    if (at > lastIndex) out.push(text.slice(lastIndex, at));
    out.push(
      // `m[1]` là username đã bỏ `@`; `m[0]` giữ nguyên chữ người dùng gõ.
      <UserLink key={`${at}-${m[1]}`} username={m[1]} testId="mention-link">
        <b style={{ color: 'var(--color-primary-strong)' }}>{m[0]}</b>
      </UserLink>,
    );
    lastIndex = at + m[0].length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? '');
}

export function PinComments({ pinId, variant }: Props) {
  const t = useT();
  const isModal = variant === 'modal';
  const { items, loading, loadingMore, hasNextPage, loadMore, refetch } = usePinComments({
    pinId,
  });
  const { status: sessionStatus } = useSession();
  const { openAuthPrompt } = useAuthPrompt();
  const confirm = useConfirm();
  const toast = useToast();

  // Khuôn `pin-detail.tsx`: `skip` khi chưa đăng nhập, nếu không thì mỗi khách
  // vãng lai tốn một query `me` chắc chắn 401.
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: sessionStatus !== 'authenticated' });
  const meId = meQuery.data?.me?.id ?? null;

  const [createComment] = useMutation(CreateCommentDocument);
  const [updateComment] = useMutation(UpdateCommentDocument);
  const [deleteComment] = useMutation(DeleteCommentDocument);
  const [toggleCommentReaction] = useMutation(ToggleCommentReactionDocument);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [openEditor, setOpenEditor] = useState<OpenEditor>(null);

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
      openAuthPrompt('auth.actionComment');
      return;
    }
    if (!canSend) return;
    setSending(true);
    try {
      await createComment({ variables: { input: { pinId, content: trimmed } } });
      await refetch();
      setText('');
    } catch {
      toast({ message: t('pin.commentFailed') });
    } finally {
      setSending(false);
    }
  };

  /**
   * DEBT-1b b1 — gửi TRẢ LỜI (`parentId` = id comment gốc).
   *
   * Trả `boolean` để hàng gọi biết có nên đóng ô và bật danh sách trả lời không.
   * Lỗi thì **giữ ô mở kèm nguyên văn người dùng vừa gõ** — đóng ô khi gửi thất
   * bại là xoá công của họ.
   *
   * `replyCount` của comment cha được `cache.modify` cộng 1: nó là field
   * server-computed nên Apollo không có cách nào tự biết nó đã đổi, và nếu để
   * nguyên thì nhãn *"Xem N trả lời"* đứng ở số cũ cho tới lần tải trang sau.
   */
  const sendReply = useCallback(
    async (parentId: string, content: string): Promise<boolean> => {
      if (sessionStatus !== 'authenticated') {
        openAuthPrompt('auth.actionReply');
        return false;
      }
      try {
        await createComment({
          variables: { input: { pinId, content, parentId } },
          update: (cache) => {
            cache.modify({
              id: cache.identify({ __typename: 'Comment', id: parentId }),
              fields: { replyCount: (n: number | null) => (n ?? 0) + 1 },
            });
          },
        });
        return true;
      } catch (e) {
        toast({
          message: REPLY_TO_REPLY.test(messageOf(e))
            ? t('pin.replyToReplyFailed')
            : t('pin.commentFailed'),
        });
        return false;
      }
    },
    [createComment, openAuthPrompt, pinId, sessionStatus, toast],
  );

  /**
   * DEBT-1b b2 — SỬA.
   *
   * `updateComment` trả `{ id content updatedAt }` (`mutation-loop.graphql:44-50`)
   * ⇒ Apollo chuẩn hoá theo `id`, **không refetch**: comment đó xuất hiện ở đâu
   * cũng đổi theo, kể cả khi nó là một reply trong cây đang mở.
   */
  const saveEdit = useCallback(
    async (id: string, content: string): Promise<boolean> => {
      if (sessionStatus !== 'authenticated') {
        openAuthPrompt('auth.actionComment');
        return false;
      }
      try {
        await updateComment({ variables: { input: { id, content } } });
        return true;
      } catch {
        toast({ message: t('pin.commentEditFailed') });
        return false;
      }
    },
    [openAuthPrompt, sessionStatus, toast, updateComment],
  );

  /**
   * DEBT-1b b2 — XOÁ. Khuôn `onDeletePin`: `useConfirm` trước, rồi mới mutate.
   *
   * `deleteComment` trả `{ id parentId }` (`mutation-loop.graphql:52-57`) —
   * `parentId` **đã được chọn sẵn từ FE-11** và đây chính là chỗ cần nó: nó cho
   * biết phải trừ `replyCount` của ai. `cache.evict` + `gc` làm cả danh sách gốc
   * lẫn cây trả lời rụng đúng dòng, **không refetch** (Apollo tự lọc ref treo).
   */
  const removeComment = useCallback(
    async (id: string): Promise<void> => {
      if (sessionStatus !== 'authenticated') {
        openAuthPrompt('auth.actionComment');
        return;
      }
      const ok = await confirm({
        title: t('pin.commentDeleteTitle'),
        body: t('pin.commentDeleteBody'),
        yesLabel: t('pin.commentDeleteYes'),
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteComment({
          variables: { id },
          update: (cache, { data }) => {
            const parentId = data?.deleteComment?.parentId ?? null;
            if (parentId) {
              cache.modify({
                id: cache.identify({ __typename: 'Comment', id: parentId }),
                fields: { replyCount: (n: number | null) => Math.max(0, (n ?? 0) - 1) },
              });
            }
            cache.evict({ id: cache.identify({ __typename: 'Comment', id }) });
            cache.gc();
          },
        });
        // KHÔNG refetch — kể cả với comment GỐC.
        //
        // Đây là chỗ khác `onSend` một cách có lý do, không phải quên: phân trang
        // ở đây là **keyset** trên `(createdAt DESC, id DESC)`, nên `endCursor`
        // là một CẶP GIÁ TRỊ chứ không phải một offset. Xoá một dòng ở giữa
        // không làm cặp đó sai, và "Xem thêm bình luận" vẫn so sánh đúng. (Thêm
        // một dòng thì khác — nó chen vào ĐẦU danh sách, nơi `merge` gộp-theo-
        // trang không có chỗ đặt, nên `onSend` mới phải đọc lại trang đầu.)
        //
        // `cache.evict` + `gc` là đủ: Apollo tự lọc ref treo khỏi mảng `items`,
        // nên dòng rụng khỏi cả danh sách gốc lẫn cây trả lời mà không tốn
        // request nào.
      } catch {
        toast({ message: t('pin.commentDeleteFailed') });
      }
    },
    [confirm, deleteComment, openAuthPrompt, refetch, sessionStatus, toast],
  );

  /**
   * DEBT-1b b3 — CẢM XÚC. UI một tim ⇒ **luôn gửi `HEART`**.
   *
   * Hợp đồng toggle giống pin: cùng loại ⇒ gỡ, chưa có ⇒ thêm. Vì chỉ có một
   * loại nên nhánh UPDATED không bao giờ chạy từ bề mặt này.
   */
  const toggleReaction = useCallback(
    async (commentId: string): Promise<void> => {
      if (sessionStatus !== 'authenticated') {
        openAuthPrompt('auth.actionReact');
        return;
      }
      try {
        await toggleCommentReaction({
          variables: { input: { commentId, type: ReactionType.Heart } },
        });
      } catch {
        toast({ message: t('pin.reactFailed') });
      }
    },
    [openAuthPrompt, sessionStatus, toast, toggleCommentReaction],
  );

  const rowActions: RowActions = {
    meId,
    openEditor,
    setOpenEditor,
    promptLogin: openAuthPrompt,
    sendReply,
    saveEdit,
    removeComment,
    toggleReaction,
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
            placeholder={t('pin.commentPlaceholder')}
            aria-label={t('pin.commentPlaceholder')}
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
            {sending ? t('pin.sending') : t('pin.send')}
          </button>
        </div>
        {tooLong && (
          <div role="alert" style={{ fontSize: 11.5, color: 'var(--color-danger)', marginTop: 4 }}>
            {t('pin.commentTooLong', { max: MAX_COMMENT_LENGTH })}
          </div>
        )}
      </>
    );

  if (loading && items.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>{t('pin.loadingComments')}</div>
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
        <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>{t('pin.noComments')}</div>
        {composer}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isModal ? 13 : 14 }}>
      {items.map((c) => (
        <CommentRow key={c.id} comment={c} variant={variant} actions={rowActions} />
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
          {loadingMore ? t('common.loading') : t('pin.loadMoreComments')}
        </button>
      )}
      {composer}
    </div>
  );
}

type CommentItem = PinCommentsQuery['pinComments']['items'][number];
type ReplyItem = CommentRepliesQuery['commentReplies']['items'][number];

/** Bộ hành động dùng chung cho mọi dòng — gom lại để khỏi kéo 7 prop qua 2 tầng. */
type RowActions = {
  meId: string | null;
  openEditor: OpenEditor;
  setOpenEditor: (v: OpenEditor) => void;
  /** i18n: nhận KEY từ điển (auth.action*), không nhận chữ. */
  promptLogin: (actionKey: TranslationKey) => void;
  sendReply: (parentId: string, content: string) => Promise<boolean>;
  saveEdit: (id: string, content: string) => Promise<boolean>;
  removeComment: (id: string) => Promise<void>;
  toggleReaction: (commentId: string) => Promise<void>;
};

function initialOf(name?: string | null, username?: string | null): string {
  const source = (name || username || '?').trim();
  return source.charAt(0).toUpperCase() || '?';
}

function Avatar({
  url,
  name,
  username,
  size,
  fontSize,
}: {
  url?: string | null;
  name?: string | null;
  username?: string | null;
  size: number;
  fontSize: number;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
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
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize,
        flex: 'none',
      }}
    >
      {initialOf(name, username)}
    </div>
  );
}

/**
 * DEBT-1b b3 — nút tim + số đếm.
 *
 * Ẩn số khi `0` (khuôn `replyCount > 0` của hàng meta). `aria-pressed` là thứ
 * duy nhất phân biệt "đã thả" với "chưa" cho phép kiểm tự động — màu chữ thì
 * không đọc được đáng tin trong harness (§32).
 */
function ReactionButton({
  count,
  reacted,
  fontSize,
  onToggle,
}: {
  count: number;
  reacted: boolean;
  fontSize: number;
  onToggle: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={reacted}
      aria-label={reacted ? t('pin.removeReaction') : t('pin.addReaction')}
      title={reacted ? t('pin.removeReaction') : t('pin.addReaction')}
      disabled={busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await onToggle();
        } finally {
          setBusy(false);
        }
      }}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        cursor: busy ? 'default' : 'pointer',
        fontSize,
        fontWeight: 700,
        color: reacted ? 'var(--color-danger)' : 'var(--color-muted)',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span aria-hidden style={{ filter: reacted ? 'none' : 'grayscale(1)' }}>
        ❤️
      </span>
      {count > 0 && <span>{count}</span>}
    </button>
  );
}

/**
 * Ô nhập inline — DÙNG CHUNG cho trả lời (b1) và sửa (b2).
 *
 * Một component cho cả hai vì bản vẽ chỉ định đúng một hình dạng, và vì hai bản
 * sao gần-giống-nhau là chỗ để lệch: `MaxLength` sửa một bên, Escape gắn một bên.
 */
function InlineEditor({
  initial,
  placeholder,
  submitLabel,
  fontSize,
  onCancel,
  onSubmit,
}: {
  initial: string;
  placeholder: string;
  submitLabel: string;
  fontSize: number;
  onCancel: () => void;
  onSubmit: (content: string) => Promise<boolean>;
}) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Mở ô là con trỏ phải nằm trong đó — mở ra rồi bắt người dùng bấm thêm một
  // lần nữa mới gõ được là hỏng thấy được, dù không phải lỗi kỹ thuật.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = value.trim();
  const tooLong = trimmed.length > MAX_COMMENT_LENGTH;
  const canSubmit = trimmed !== '' && !tooLong && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Đóng ô CHỈ khi hàng gọi báo thành công — thất bại thì giữ nguyên chữ
      // người dùng vừa gõ để họ thử lại, đừng xoá công của họ.
      if (await onSubmit(trimmed)) onCancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 7 }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-invalid={tooLong || undefined}
          disabled={busy}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 'var(--radius-button)',
            border: tooLong ? '1px solid var(--color-danger)' : '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-foreground)',
            fontSize,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-button)',
            border: 'none',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
            fontWeight: 700,
            fontSize,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: canSubmit ? 1 : 0.6,
          }}
        >
          {busy ? t('pin.sending') : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-foreground)',
            fontWeight: 600,
            fontSize,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {t('common.cancel')}
        </button>
      </div>
      {tooLong && (
        <div role="alert" style={{ fontSize: 11.5, color: 'var(--color-danger)', marginTop: 4 }}>
          {t('pin.commentTooLong', { max: MAX_COMMENT_LENGTH })}
        </div>
      )}
    </div>
  );
}

/** Menu `⋯` của một dòng bình luận — chép khuôn `pin-detail.tsx` (headerRow). */
function OwnerMenu({
  fontSize,
  onEdit,
  onDelete,
}: {
  fontSize: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = {
    textAlign: 'left' as const,
    padding: '8px 11px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    width: '100%',
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        aria-label={t('pin.commentOptions')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontSize,
          fontWeight: 700,
          color: 'var(--color-muted)',
          lineHeight: 1,
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 18,
            left: 0,
            minWidth: 132,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-modal)',
            padding: 5,
            zIndex: 'var(--z-dropdown)' as unknown as number,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            style={{ ...item, color: 'var(--color-foreground)' }}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            style={{ ...item, color: 'var(--color-danger)' }}
          >
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  variant,
  actions,
}: {
  comment: CommentItem;
  variant: Variant;
  actions: RowActions;
}) {
  const t = useT();
  const isModal = variant === 'modal';
  const [showReplies, setShowReplies] = useState(false);
  const user = comment.user ?? null;
  const authorName = user?.name || user?.username || t('pin.someUser');
  const replyCount = comment.replyCount ?? 0;
  const avatarSize = isModal ? 28 : 30;
  const textSize = isModal ? 13 : 13.5;
  const metaSize = isModal ? 11 : 11.5;

  const isMine = actions.meId != null && user?.id === actions.meId;
  const editing = actions.openEditor?.id === comment.id && actions.openEditor.mode === 'edit';
  const replying = actions.openEditor?.id === comment.id && actions.openEditor.mode === 'reply';

  /**
   * `refetch` của `useCommentReplies` sống trong `CommentRepliesList` (nơi hook
   * chạy), nhưng nút "Trả lời" ở đây. Đăng ký qua ref thay vì `key`-remount:
   * remount sẽ reset phân trang, nên ai vừa bấm "Xem thêm trả lời" sẽ bị kéo về
   * trang đầu chỉ vì họ gửi thêm một trả lời.
   */
  const repliesRefetch = useRef<null | (() => Promise<unknown>)>(null);

  const afterReplySent = async () => {
    if (showReplies && repliesRefetch.current) {
      // Danh sách đang mở ⇒ đọc lại ĐÚNG cây của comment này. Không refetch cả
      // `pinComments`: trả lời không đổi danh sách gốc.
      await repliesRefetch.current();
    } else {
      // Chưa mở ⇒ mở ra là hook tự chạy lần đầu, đã bao gồm cái vừa gửi.
      setShowReplies(true);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10 }}>
        <UserLink username={user?.username} title={authorName} testId="comment-author-avatar">
          <Avatar
            url={user?.avatarUrl}
            name={user?.name}
            username={user?.username}
            size={avatarSize}
            fontSize={isModal ? 11.5 : 12}
          />
        </UserLink>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: textSize,
              lineHeight: 1.5,
              color: 'var(--color-foreground)',
            }}
          >
            <UserLink username={user?.username} testId="comment-author-name">
              <b>{authorName}</b>
            </UserLink>{' '}
            {renderWithMentions(comment.content)}
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
              {formatRelative(comment.createdAt, t)}
            </div>
            <ReactionButton
              count={comment.reactionCount ?? 0}
              reacted={comment.isReactedByViewer ?? false}
              fontSize={metaSize}
              onToggle={() => void actions.toggleReaction(comment.id)}
            />
            {/*
              Guard ở LÚC MỞ, không chỉ lúc gửi. `sendReply` vẫn có guard riêng
              (nó là hàng rào thật, chạy sát mutation), nhưng nếu chỉ chặn ở đó
              thì khách mở được ô, gõ xong cả câu rồi mới bị bảo "đăng nhập đi" —
              mất công họ, và **lệch với nút tim ngay bên cạnh** vốn chặn ngay từ
              cú bấm. Hai bề mặt cạnh nhau phải trả lời cùng một câu hỏi giống nhau.
            */}
            <button
              type="button"
              onClick={() => {
                if (actions.meId == null) {
                  actions.promptLogin('auth.actionReply');
                  return;
                }
                actions.setOpenEditor(replying ? null : { id: comment.id, mode: 'reply' });
              }}
              aria-expanded={replying}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontSize: metaSize,
                fontWeight: 700,
                color: replying ? 'var(--color-primary-strong)' : 'var(--color-muted)',
              }}
            >
              {t('pin.reply')}
            </button>
            {/*
              Menu chỉ tồn tại cho chủ bình luận. Không phải "hiện rồi để server
              chặn": bình luận của người khác **không được có** nút Sửa/Xoá nào
              để bấm — đó là một phép nghiệm thu của đợt này.
            */}
            {isMine && (
              <OwnerMenu
                fontSize={metaSize + 2}
                onEdit={() => actions.setOpenEditor({ id: comment.id, mode: 'edit' })}
                onDelete={() => void actions.removeComment(comment.id)}
              />
            )}
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
                {showReplies
                  ? t('pin.hideReplies')
                  : t('pin.showReplies', { count: replyCount })}
              </button>
            )}
          </div>
          {editing && (
            <InlineEditor
              initial={comment.content}
              placeholder={t('pin.editComment')}
              submitLabel={t('common.save')}
              fontSize={textSize}
              onCancel={() => actions.setOpenEditor(null)}
              onSubmit={(content) => actions.saveEdit(comment.id, content)}
            />
          )}
          {replying && (
            <InlineEditor
              // REVIEW-1 (#9) — `key` ép remount khi đổi người được trả lời:
              // `InlineEditor` chỉ đọc `initial` lúc mount (useState(initial)),
              // nên không có key thì bấm "Trả lời" ở một reply khác sẽ giữ
              // nguyên "@tên" cũ.
              key={actions.openEditor?.prefill ?? ''}
              initial={actions.openEditor?.prefill ?? ''}
              placeholder={t('pin.replyTo', { name: authorName })}
              submitLabel={t('pin.send')}
              fontSize={textSize}
              onCancel={() => actions.setOpenEditor(null)}
              onSubmit={async (content) => {
                const ok = await actions.sendReply(comment.id, content);
                if (ok) await afterReplySent();
                return ok;
              }}
            />
          )}
          {showReplies && (
            <CommentRepliesList
              commentId={comment.id}
              variant={variant}
              actions={actions}
              onRefetchReady={(fn) => {
                repliesRefetch.current = fn;
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CommentRepliesList({
  commentId,
  variant,
  actions,
  onRefetchReady,
}: {
  commentId: string;
  variant: Variant;
  actions: RowActions;
  onRefetchReady: (fn: () => Promise<unknown>) => void;
}) {
  const t = useT();
  const isModal = variant === 'modal';
  const { items, loading, loadingMore, hasNextPage, loadMore, refetch } = useCommentReplies({
    commentId,
  });
  const textSize = isModal ? 12.5 : 13;
  const metaSize = isModal ? 11 : 11.5;
  const avatarSize = isModal ? 24 : 26;

  useEffect(() => {
    onRefetchReady(refetch);
  }, [onRefetchReady, refetch]);

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
        {t('pin.loadingReplies')}
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
        const author = ru?.name || ru?.username || t('pin.someUser');
        const mine = actions.meId != null && ru?.id === actions.meId;
        const editingThis =
          actions.openEditor?.id === r.id && actions.openEditor.mode === 'edit';
        return (
          <div key={r.id} style={{ display: 'flex', gap: 8, paddingLeft: 10 }}>
            <UserLink username={ru?.username} title={author} testId="reply-author-avatar">
              <Avatar
                url={ru?.avatarUrl}
                name={ru?.name}
                username={ru?.username}
                size={avatarSize}
                fontSize={11}
              />
            </UserLink>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: textSize,
                  lineHeight: 1.5,
                  color: 'var(--color-foreground)',
                }}
              >
                <UserLink username={ru?.username} testId="reply-author-name">
                  <b>{author}</b>
                </UserLink>{' '}
                {renderWithMentions(r.content)}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  marginTop: 3,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontSize: metaSize, color: 'var(--color-muted)' }}>
                  {formatRelative(r.createdAt, t)}
                </div>
                <ReactionButton
                  count={r.reactionCount ?? 0}
                  reacted={r.isReactedByViewer ?? false}
                  fontSize={metaSize}
                  onToggle={() => void actions.toggleReaction(r.id)}
                />
                {/*
                  REVIEW-1 (#9) — nút "Trả lời" ở tầng 2, kiểu Facebook.
                  Trước đợt này chỗ này CỐ Ý bỏ trống vì backend chặn cứng
                  "trả lời vào một trả lời". Người dùng muốn trả lời tiếp được
                  mà KHÔNG thụt sâu thêm — đúng hình dạng backend đang cho phép.
                  Nên nút này gửi `parentId` = comment GỐC (`commentId`, không
                  phải `r.id`) và điền sẵn "@username" để người đọc biết dòng
                  này đáp ai. Cây vẫn 2 tầng, luật backend không phải đổi.
                */}
                <button
                  type="button"
                  data-testid="reply-to-reply"
                  onClick={() => {
                    // Cùng khuôn guard với nút "Trả lời" ở tầng 1 ngay trên.
                    if (actions.meId == null) {
                      actions.promptLogin('auth.actionReply');
                      return;
                    }
                    actions.setOpenEditor({
                      id: commentId,
                      mode: 'reply',
                      prefill: ru?.username ? `@${ru.username} ` : '',
                    });
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    fontSize: metaSize,
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: 'var(--color-muted)',
                  }}
                >
                  {t('pin.reply')}
                </button>
                {mine && (
                  <OwnerMenu
                    fontSize={metaSize + 2}
                    onEdit={() => actions.setOpenEditor({ id: r.id, mode: 'edit' })}
                    onDelete={() => void actions.removeComment(r.id)}
                  />
                )}
              </div>
              {editingThis && (
                <InlineEditor
                  initial={r.content}
                  placeholder={t('pin.editComment')}
                  submitLabel={t('common.save')}
                  fontSize={textSize}
                  onCancel={() => actions.setOpenEditor(null)}
                  onSubmit={(content) => actions.saveEdit(r.id, content)}
                />
              )}
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
          {loadingMore ? t('common.loading') : t('pin.loadMoreReplies')}
        </button>
      )}
    </div>
  );
}

/**
 * i18n (23/08/2026) — nhận `t` làm tham số thay vì tự chứa chữ Việt.
 * Không đổi thành hook: hàm này được gọi trong thân JSX của nhiều component
 * khác nhau, truyền `t` xuống rẻ hơn và không đụng luật hook.
 * Ngưỡng (60s · 60m · 24h · 30d · 12mo) giữ NGUYÊN. Bản tiếng Anh cố ý dùng
 * dạng NGẮN (5m · 3h · 2d) vì chuỗi này nằm sát tên người trên một dòng chật.
 */
function formatRelative(iso: string, t: TFunction): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return t('pin.timeSeconds', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('pin.timeMinutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('pin.timeHours', { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return t('pin.timeDays', { n: d });
  const mo = Math.floor(d / 30);
  if (mo < 12) return t('pin.timeMonths', { n: mo });
  return t('pin.timeYears', { n: Math.floor(mo / 12) });
}
