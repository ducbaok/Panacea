'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, useSession } from 'next-auth/react';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  PinDocument,
  type PinQuery,
  type PinQueryVariables,
  SavePinDocument,
  type SavePinMutation,
  type SavePinMutationVariables,
  UnsavePinDocument,
  type UnsavePinMutation,
  type UnsavePinMutationVariables,
  MeDocument,
  type MeQuery,
  DeletePinDocument,
  type DeletePinMutation,
  type DeletePinMutationVariables,
  TrackPinViewDocument,
} from '@/lib/gql/graphql';
import { toReadState } from '@/lib/errors/map-error';
import { REACTION_ORDER, REACTION_EMOJI, REACTION_LABEL } from '@/lib/reactions';
import { useAuthPrompt } from '@/components/auth/auth-prompt';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useBoardPicker } from '@/components/board/board-picker';
import { PinComments } from './pin-comments';

/**
 * FE-4 — Body chi tiết pin, dùng chung cho bản modal và bản trang đầy đủ.
 *
 * MỘT component + `variant` — không tách 2 component, cũng KHÔNG ép hai bản
 * giống hệt nhau. `PROMPT_FE4.md` §3.4 liệt kê 8 dòng khác biệt: thứ tự khối
 * đảo (modal: h1 → mô tả → cảm xúc · page: cảm xúc → h1 → mô tả), cỡ chữ khác
 * (h1 24 vs 27, mô tả 14 vs 14.5), avatar tác giả khác (38 vs 40), và 4 khối
 * CHỈ có ở page: dòng phụ tác giả · dải tag · ô soạn bình luận · nút Chia sẻ.
 *
 * ⚠️ ĐỌC + ĐIỀU HƯỚNG. Không gọi mutation nào (PROMPT_FE4.md §1). Nút Lưu,
 * hàng cảm xúc, nút Theo dõi, ô soạn — dựng đủ hình + đọc đúng trạng thái từ
 * API, nhưng KHÔNG mutate. Ràng buộc là "màn đăng nhập là FE-5, chưa có" ⇒
 * viết mutation bây giờ = code chạy mà không nghiệm thu được.
 *
 * Pill board (`{{ detailBoard }}`) — API không có dữ liệu này (§4.2). Render
 * trung tính "Lưu vào bảng ▾", `disabled`. BoardPicker là FE-7.
 *
 * Ảnh: `largeUrl ?? mediumUrl ?? imageUrl` — 3 URL responsive nullable ở dev
 * (bẫy 8). Vẫn phải xuống được `imageUrl` (non-null theo SDL).
 *
 * next/image bị bỏ (bẫy 6) — `next.config.ts` chưa khai `remotePatterns`, ảnh
 * seed đến từ `images.unsplash.com`.
 */

type Variant = 'modal' | 'page';

function pickDetailImageUrl(pin: NonNullable<PinQuery['pin']>): string {
  return pin.largeUrl ?? pin.mediumUrl ?? pin.imageUrl;
}

function initialOf(name: string | null | undefined, username: string | null | undefined): string {
  const source = (name || username || '?').trim();
  return source.charAt(0).toUpperCase() || '?';
}

function formatFollowerCount(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n) || n < 0) return null;
  const rounded = Math.floor(n);
  if (rounded < 1000) return `${rounded} người theo dõi`;
  if (rounded < 1_000_000) return `${(rounded / 1000).toFixed(rounded < 10_000 ? 1 : 0)}K người theo dõi`;
  return `${(rounded / 1_000_000).toFixed(1)}M người theo dõi`;
}

type Props = {
  pinId: string;
  variant: Variant;
  /** Chỉ variant='modal' truyền — trang đầy đủ dùng "← Quay lại lưới" riêng. */
  onClose?: () => void;
};

export function PinDetail({ pinId, variant, onClose }: Props) {
  const query = useQuery<PinQuery, PinQueryVariables>(PinDocument, {
    variables: { id: pinId },
  });
  // Apollo v4 `Result` có `error?: unknown`; toReadState nhận `error: unknown`
  // (required). Chuyển shape tường minh — đừng spread `query` vì các field
  // khác sẽ chèn vào và làm lệch signature.
  const state = toReadState({
    data: query.data,
    loading: query.loading,
    error: query.error,
  });

  if (state.phase === 'loading') {
    return (
      <div
        role="status"
        aria-label="Đang tải pin"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 200,
          color: 'var(--color-muted)',
          fontSize: 13.5,
        }}
      >
        Đang tải…
      </div>
    );
  }

  if (state.phase === 'error') {
    const message =
      state.state.kind === 'not-found'
        ? 'Không tìm thấy pin này.'
        : state.state.kind === 'network'
          ? 'Không kết nối được máy chủ.'
          : 'Không tải được pin.';
    return (
      <div
        role="alert"
        data-error-kind={state.state.kind}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
          gap: 8,
          padding: 24,
          textAlign: 'center',
          color: 'var(--color-muted)',
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 700, color: 'var(--color-foreground)' }}>{message}</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 16px',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13.5,
            }}
          >
            Đóng
          </button>
        )}
      </div>
    );
  }

  const pin = state.data.pin;
  if (!pin) {
    return (
      <div
        role="alert"
        data-error-kind="not-found"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
          color: 'var(--color-muted)',
          fontSize: 14,
          padding: 24,
        }}
      >
        Không tìm thấy pin này.
      </div>
    );
  }

  return <PinDetailContent pin={pin} variant={variant} onClose={onClose} />;
}

function PinDetailContent({
  pin,
  variant,
  onClose,
}: {
  pin: NonNullable<PinQuery['pin']>;
  variant: Variant;
  onClose?: () => void;
}) {
  const isModal = variant === 'modal';
  const [optimisticSaved, setOptimisticSaved] = useState<boolean | null>(null);
  const [optimisticFollow, setOptimisticFollow] = useState<boolean | null>(null);
  const [optimisticReaction, setOptimisticReaction] = useState<string | null>(null);
  const { status: sessionStatus } = useSession();
  const { openAuthPrompt } = useAuthPrompt();
  const { openBoardPicker } = useBoardPicker();
  const toast = useToast();
  const [savePin] = useMutation<SavePinMutation, SavePinMutationVariables>(SavePinDocument);
  const [unsavePin] = useMutation<UnsavePinMutation, UnsavePinMutationVariables>(UnsavePinDocument);
  const [saveBusy, setSaveBusy] = useState(false);
  const router = useRouter();
  const confirm = useConfirm();
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: sessionStatus !== 'authenticated' });
  const [deletePin] = useMutation<DeletePinMutation, DeletePinMutationVariables>(DeletePinDocument);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwner = meQuery.data?.me?.id != null && meQuery.data.me.id === pin.creator.id;

  /**
   * FE-10 (wire B-4) — đo lượt xem pin. MỘT điểm gọi cho cả hai bản (modal
   * `@modal/(.)pin/[id]` và trang `/pin/[id]`) vì cả hai dùng chung component này.
   *
   * • **LOẠI self-view** (người dùng chốt 17/08): chủ pin xem pin của mình KHÔNG
   *   được đếm. Backend hiện đếm cả chủ pin, nên chặn ở đây là chỗ duy nhất.
   * • **Chờ danh tính rõ ràng trước khi gọi.** `sessionStatus === 'loading'` hoặc
   *   `me` chưa về ⇒ chưa biết người xem có phải chủ pin không; gọi sớm là tự
   *   đếm mất một lượt self-view. Khách (`unauthenticated`) thì gọi ngay — danh
   *   tính của họ là header `x-anon-id`.
   * • **Fire-and-forget.** Boolean trả về là "lần này CÓ tăng bộ đếm không"
   *   (`false` khi trong cửa sổ debounce 30 phút, hoặc pin không có `sourceUrl`
   *   với click, hoặc không định danh được) — KHÔNG phải mã lỗi. Không toast,
   *   không render theo kết quả, lỗi thì im lặng: một phép đo hụt không được làm
   *   hỏng màn xem pin.
   * • Một lần cho MỖI pinId trong một lần mount (ref chặn double-invoke của
   *   StrictMode; debounce 30 phút của backend là lưới thứ hai, không phải thứ nhất).
   */
  /*
   * TODO(FE-10): CHỜ NGƯỜI DÙNG — `trackPinClick` chưa wire vì KHÔNG có bề mặt
   * gọi nào đã vẽ. Màn chi tiết pin không render `pin.sourceUrl`, và
   * `Panacea-v2.1.html` chỉ vẽ Ô NHẬP "Link nguồn" ở form tạo/sửa pin (B4/B5) —
   * không có link nguồn bấm được ở màn xem. Thêm link = bịa giao diện (luật 19),
   * nên người dùng chốt 17/08: hoãn Click, đợt này chỉ wire View.
   * Mở lại khi có bản vẽ link nguồn: gọi `TrackPinClickDocument` (operation đã
   * sinh sẵn ở pin.graphql) ngay tại chỗ mở link, fire-and-forget như View.
   */
  const [trackView] = useMutation(TrackPinViewDocument);
  const trackedPinIdRef = useRef<string | null>(null);

  /**
   * 🔴 BẪY ĐÃ TRẢ GIÁ TRONG ĐỢT NÀY (đo được, không phải phòng xa):
   * `useSession().status` KHÔNG đáng tin ở lần render đầu của một tab LẠNH.
   * `<SessionProvider>` (app/providers.tsx) không được truyền `session` sẵn nên
   * mỗi lần tải trang nó phải tự fetch `/api/auth/session`; trong cửa sổ đó
   * `status` đã có thể là `'unauthenticated'` dù cookie phiên vẫn còn.
   *
   * Hậu quả đo được: mở pin CỦA CHÍNH MÌNH trong tab mới ⇒ guard tưởng là khách
   * ⇒ `trackPinView` bắn ⇒ viewCount 0→1, tức self-view vẫn bị đếm (đúng thứ
   * người dùng đã chốt phải loại). Không có lỗi nào hiện ra: request 200, UI
   * bình thường. Đây là bẫy 1 (viewer-aware im lặng) ở dạng thời gian.
   *
   * Vì thế "là khách" phải được XÁC NHẬN bằng nguồn xác thực (`getSession()` gọi
   * thẳng `/api/auth/session`), không suy từ status. Ràng buộc này đồng thời bảo
   * đảm điều thứ hai: khi phiên CÓ thật, ta chờ tới lúc `me` về — lúc đó Apollo
   * authLink cũng đã có token, nên lượt đếm mang đúng danh tính chứ không rơi về
   * `x-anon-id`.
   */
  const [guestConfirmed, setGuestConfirmed] = useState(false);
  useEffect(() => {
    if (sessionStatus !== 'unauthenticated') return;
    let cancelled = false;
    void getSession().then((s) => {
      if (!cancelled && !s) setGuestConfirmed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionStatus]);

  /**
   * Danh tính phải là bằng chứng DƯƠNG, không phải "hết loading".
   *
   * Bản đầu của đợt này viết `meQuery.data !== undefined || meQuery.error !== undefined`
   * và đo được là SAI: khi `me` lỗi 401 (request bay ra trước lúc authLink kịp có
   * token — cửa sổ vài chục ms ở tab lạnh), nhánh `error` làm `identityKnown` bật,
   * `isOwner` là false vì chưa có `me`, và lượt xem CỦA CHÍNH CHỦ PIN bị đếm —
   * xác nhận bằng viewCount 1→2 kèm khoá Redis `track:view:pin_6_id:u:user_2_id`.
   *
   * Nay chỉ chấp nhận: (a) đã xác nhận là KHÁCH bằng getSession(), hoặc (b) đọc
   * ĐƯỢC `me.id`. Nếu `me` lỗi mãi thì lượt xem đó không được đếm — mất một phép
   * đo còn hơn đếm sai vào đúng cái ta vừa hứa loại.
   */
  const identityKnown =
    (sessionStatus === 'unauthenticated' && guestConfirmed) ||
    (sessionStatus === 'authenticated' && !!meQuery.data?.me?.id);

  useEffect(() => {
    if (!identityKnown) return;
    if (isOwner) return; // self-view: cố ý không đếm
    if (trackedPinIdRef.current === pin.id) return;
    trackedPinIdRef.current = pin.id;
    void trackView({ variables: { pinId: pin.id } }).catch(() => {
      // Im lặng — xem mục "fire-and-forget" ở trên.
    });
  }, [identityKnown, isOwner, pin.id, trackView]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const isSaved = optimisticSaved ?? pin.isSavedByViewer ?? false;
  const isFollowed = optimisticFollow ?? pin.creator.isFollowedByViewer ?? false;
  const currentReaction = optimisticReaction ?? pin.viewerReaction ?? null;
  const imgUrl = pickDetailImageUrl(pin);
  const title = pin.title || pin.description || 'Pin không tiêu đề';
  const description = pin.description ?? '';
  const followerLabel = formatFollowerCount(pin.creator.followerCount);
  const authorName = pin.creator.name || pin.creator.username || 'Người dùng';

  // Pill "Lưu vào bảng ▾" → mở BoardPicker (save mode). Khách → AuthPrompt.
  const openPicker = () => {
    if (sessionStatus === 'unauthenticated') {
      openAuthPrompt('lưu pin này');
      return;
    }
    openBoardPicker({ mode: 'save', pinId: pin.id });
  };

  // Lưu lại sau Hoàn tác — im lặng.
  const resaveQuiet = async () => {
    setOptimisticSaved(true);
    try {
      await savePin({ variables: { input: { pinId: pin.id } } });
    } catch {
      setOptimisticSaved(false);
    }
  };

  // Nút Lưu = lưu nhanh vào HỒ SƠ (boardId null) — nợ FE-6b: thêm nhánh khách.
  const toggleSave = async () => {
    if (sessionStatus === 'unauthenticated') {
      openAuthPrompt('lưu pin này');
      return;
    }
    if (saveBusy) return;
    const next = !isSaved;
    setOptimisticSaved(next);
    setSaveBusy(true);
    try {
      if (next) {
        await savePin({ variables: { input: { pinId: pin.id } } });
      } else {
        await unsavePin({
          variables: { pinId: pin.id },
          update: (cache) =>
            cache.modify({
              id: cache.identify({ __typename: 'Pin', id: pin.id }),
              fields: { isSavedByViewer: () => false },
            }),
        });
        toast({
          message: 'Đã bỏ lưu',
          action: { label: 'Hoàn tác', onClick: () => void resaveQuiet() },
        });
      }
    } catch {
      setOptimisticSaved(!next);
      toast({ message: 'Không lưu được, thử lại sau.' });
    } finally {
      setSaveBusy(false);
    }
  };

  const onEditPin = () => {
    setMenuOpen(false);
    router.push(`/pin/${pin.id}/edit`);
  };

  const onDeletePin = async () => {
    setMenuOpen(false);
    const ok = await confirm({
      title: `Xoá "${pin.title?.trim() || 'pin này'}"?`,
      body: 'Pin và bình luận trên đó sẽ không còn hiển thị.',
      yesLabel: 'Xoá pin',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePin({
        variables: { id: pin.id },
        update: (cache) => {
          cache.evict({ id: cache.identify({ __typename: 'Pin', id: pin.id }) });
          cache.gc();
        },
      });
      toast({ message: 'Đã xoá pin' });
      router.push('/');
    } catch {
      toast({ message: 'Không xoá được pin, thử lại sau.' });
    }
  };

  const headerRow = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: isModal ? 18 : 20,
      }}
    >
      {isModal ? (
        <>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              cursor: 'pointer',
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            ×
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>
            ESC để đóng · bấm nền để đóng
          </div>
        </>
      ) : (
        <>
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label="Thêm tuỳ chọn"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-foreground)',
                cursor: 'pointer',
                fontSize: 15,
                lineHeight: 1,
              }}
            >
              ⋯
            </button>
            {menuOpen && isOwner && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: 44,
                  left: 0,
                  minWidth: 150,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 12,
                  boxShadow: 'var(--shadow-modal)',
                  padding: 6,
                  zIndex: 'var(--z-dropdown)' as unknown as number,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={onEditPin}
                  style={{ textAlign: 'left', padding: '9px 12px', border: 'none', background: 'none', color: 'var(--color-foreground)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, borderRadius: 8, width: '100%' }}
                >
                  Sửa pin
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void onDeletePin()}
                  style={{ textAlign: 'left', padding: '9px 12px', border: 'none', background: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, borderRadius: 8, width: '100%' }}
                >
                  Xoá pin
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            style={{
              padding: '10px 16px',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13.5,
            }}
          >
            Chia sẻ
          </button>
        </>
      )}
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={openPicker}
        aria-label="Chọn board để lưu pin"
        style={{
          padding: isModal ? '9px 16px' : '10px 18px',
          borderRadius: 'var(--radius-button)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-foreground)',
          fontWeight: 600,
          fontSize: isModal ? 13 : 13.5,
          cursor: 'pointer',
        }}
      >
        Lưu vào bảng ▾
      </button>
      <button
        type="button"
        aria-pressed={isSaved}
        onClick={() => void toggleSave()}
        style={{
          padding: isModal ? '9px 16px' : '10px 18px',
          borderRadius: 'var(--radius-button)',
          border: 'none',
          fontWeight: 700,
          fontSize: isModal ? 13 : 13.5,
          cursor: 'pointer',
          background: isSaved ? 'var(--color-foreground)' : 'var(--color-primary)',
          color: isSaved ? 'var(--color-background)' : 'var(--color-primary-foreground)',
        }}
      >
        {isSaved ? 'Đã lưu' : 'Lưu'}
      </button>
    </div>
  );

  const reactionsRow = (
    <div
      role="group"
      aria-label="Chọn cảm xúc"
      style={{
        display: 'flex',
        gap: 6,
        marginBottom: 18,
        flexWrap: 'wrap',
      }}
    >
      {REACTION_ORDER.map((r) => {
        const active = currentReaction === r;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={active}
            title={REACTION_LABEL[r]}
            onClick={() => setOptimisticReaction(active ? null : r)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 'var(--radius-button)',
              border: active ? '1px solid var(--color-primary-strong)' : '1px solid var(--color-border)',
              background: active ? 'var(--color-primary-soft)' : 'var(--color-surface)',
              color: 'var(--color-foreground)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>
              {REACTION_EMOJI[r]}
            </span>
            <span>{REACTION_LABEL[r]}</span>
          </button>
        );
      })}
    </div>
  );

  const h1 = (
    <h1
      style={{
        fontFamily: 'var(--font-display), var(--font-be-vietnam-pro), sans-serif',
        fontSize: isModal ? 24 : 27,
        margin: '0 0 10px',
        lineHeight: 1.25,
        color: 'var(--color-foreground)',
      }}
    >
      {title}
    </h1>
  );

  const descP = description ? (
    <p
      style={{
        fontSize: isModal ? 14 : 14.5,
        lineHeight: 1.65,
        color: 'var(--color-muted)',
        margin: '0 0 18px',
      }}
    >
      {description}
    </p>
  ) : null;

  const tagsRow =
    !isModal && pin.tags.length > 0 ? (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 7,
          marginBottom: 20,
        }}
      >
        {pin.tags.map((t) => (
          <span
            key={t.id}
            style={{
              padding: '5px 11px',
              borderRadius: 'var(--radius-button)',
              background: 'var(--color-surface-muted)',
              color: 'var(--color-muted)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            #{t.name}
          </span>
        ))}
      </div>
    ) : null;

  const authorRow = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '14px 0',
        borderTop: '1px solid var(--color-border)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {pin.creator.avatarUrl ? (
        <img
          src={pin.creator.avatarUrl}
          alt=""
          style={{
            width: isModal ? 38 : 40,
            height: isModal ? 38 : 40,
            borderRadius: '50%',
            objectFit: 'cover',
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            width: isModal ? 38 : 40,
            height: isModal ? 38 : 40,
            borderRadius: '50%',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
          }}
        >
          {initialOf(pin.creator.name, pin.creator.username)}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: isModal ? 13.5 : 14,
            color: 'var(--color-foreground)',
          }}
        >
          {authorName}
        </div>
        {!isModal && followerLabel && (
          <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{followerLabel}</div>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        aria-pressed={isFollowed}
        onClick={() => setOptimisticFollow(!isFollowed)}
        style={{
          padding: isModal ? '8px 16px' : '9px 18px',
          borderRadius: 'var(--radius-button)',
          border: isFollowed ? '1px solid var(--color-border)' : 'none',
          background: isFollowed ? 'var(--color-surface)' : 'var(--color-foreground)',
          color: isFollowed ? 'var(--color-foreground)' : 'var(--color-background)',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        {isFollowed ? 'Đang theo dõi' : 'Theo dõi'}
      </button>
    </div>
  );

  const rightColumn = (
    <div
      style={
        isModal
          ? { padding: '26px 28px', overflowY: 'auto', maxHeight: '82vh' }
          : { padding: '26px 28px' }
      }
    >
      {headerRow}

      {isModal ? (
        <>
          {h1}
          {descP}
          {reactionsRow}
        </>
      ) : (
        <>
          {reactionsRow}
          {h1}
          {descP}
          {tagsRow}
        </>
      )}

      {authorRow}

      <div style={{ paddingTop: 16 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: isModal ? 14 : 14.5,
            marginBottom: 12,
            color: 'var(--color-foreground)',
          }}
        >
          Bình luận
        </div>
        <PinComments pinId={pin.id} variant={variant} />
      </div>

      {isModal && (
        <div style={{ marginTop: 18 }}>
          <a
            href={`/pin/${pin.id}`}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--color-primary-strong)',
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Mở trang đầy đủ (F5 / link trực tiếp) →
          </a>
        </div>
      )}
    </div>
  );

  const imageColumn = (
    <div
      style={{
        background: 'var(--color-surface-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
      }}
    >
      <img
        src={imgUrl}
        alt={title}
        style={{
          width: '100%',
          height: '100%',
          maxHeight: isModal ? '82vh' : 'none',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </div>
  );

  return (
    <div
      className="pin-detail-frame"
      data-variant={variant}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        background: 'var(--color-surface)',
        borderRadius: isModal ? 26 : 24,
        overflow: 'hidden',
        border: isModal ? 'none' : '1px solid var(--color-border)',
        boxShadow: isModal ? 'var(--shadow-modal)' : 'var(--shadow-card)',
        width: '100%',
        maxHeight: isModal ? '100%' : 'none',
      }}
    >
      {imageColumn}
      {rightColumn}
    </div>
  );
}
