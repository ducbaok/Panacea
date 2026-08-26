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
  TrackPinClickDocument,
  TogglePinReactionDocument,
  FollowDocument,
  UnfollowDocument,
  RepublishPinDocument,
  type RepublishPinMutation,
  type RepublishPinMutationVariables,
  MyCirclesDocument,
  type MyCirclesQuery,
  type MyCirclesQueryVariables,
  Visibility,
  type ReactionType,
} from '@/lib/gql/graphql';
import { toReadState } from '@/lib/errors/map-error';
import { REACTION_ORDER, REACTION_EMOJI, REACTION_LABEL_KEY } from '@/lib/reactions';
import { circleDisplayName, republishAudienceName } from '@/lib/visibility';
import { useT } from '@/lib/i18n/provider';
import { useAuthPrompt } from '@/components/auth/auth-prompt';
import { UserLink } from '@/components/profile/user-link';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useBoardPicker } from '@/components/board/board-picker';
import { PinComments } from './pin-comments';
import { PinViewersRow } from './pin-viewers';

/**
 * FE-4 — Body chi tiết pin, dùng chung cho bản modal và bản trang đầy đủ.
 *
 * MỘT component + `variant` — không tách 2 component, cũng KHÔNG ép hai bản
 * giống hệt nhau. `PROMPT_FE4.md` §3.4 liệt kê 8 dòng khác biệt: thứ tự khối
 * đảo (modal: h1 → mô tả → cảm xúc · page: cảm xúc → h1 → mô tả), cỡ chữ khác
 * (h1 24 vs 27, mô tả 14 vs 14.5), avatar tác giả khác (38 vs 40), và 4 khối
 * CHỈ có ở page: dòng phụ tác giả · dải tag · ô soạn bình luận · nút Chia sẻ.
 *
 * ⚠️ LỊCH SỬ CỦA CÁI BANNER NÀY — đọc trước khi tin comment trong file:
 * bản FE-4 viết ở đây "không gọi mutation nào … nút Lưu, hàng cảm xúc, nút Theo
 * dõi, ô soạn — dựng đủ hình nhưng KHÔNG mutate". Câu đó **sai từ FE-7** mà
 * không ai sửa, và nó là cơ chế đã GIẤU 3 nút chết suốt 4 đợt: người sau đọc
 * banner, tin rằng ở đây không có gì để nối, nên không mở file ra kiểm. Bài học
 * ở `LEARNING_NOTES.md` §31.
 *
 * Hiện trạng SAU FE-11 (17/08/2026) — file này mutate THẬT, 7 mutation:
 *   • `savePin` / `unsavePin` / `deletePin`  (FE-7)
 *   • `trackPinView`                          (FE-10, wire B-4)
 *   • `togglePinReaction` / `follow` / `unfollow` (FE-11)
 * Ô soạn bình luận sống ở `pin-comments.tsx` (`createComment`, FE-4).
 * Còn treo: `trackPinClick` — xem TODO ở dưới, chặn vì thiếu bản vẽ.
 *
 * Pill board (`{{ detailBoard }}`) — API không có dữ liệu này (§4.2). Render
 * trung tính "Lưu vào bảng ▾"; từ FE-7 nó mở `BoardPicker` (không còn disabled).
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

/**
 * i18n (23/08/2026) — hàm này TRƯỚC ĐÂY trả nguyên câu "N người theo dõi".
 * Nay chỉ trả PHẦN SỐ đã rút gọn ("949", "1.2K", "3.4M"); chữ "người theo dõi"
 * / "followers" do `t('pin.followerCount')` ghép. Ngưỡng làm tròn giữ NGUYÊN.
 * Trả `null` khi không có số ⇒ chỗ dùng ẩn cả dòng.
 */
function formatFollowerCount(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n) || n < 0) return null;
  const rounded = Math.floor(n);
  if (rounded < 1000) return String(rounded);
  if (rounded < 1_000_000) return `${(rounded / 1000).toFixed(rounded < 10_000 ? 1 : 0)}K`;
  return `${(rounded / 1_000_000).toFixed(1)}M`;
}

type Props = {
  pinId: string;
  variant: Variant;
  /** Chỉ variant='modal' truyền — trang đầy đủ dùng "← Quay lại lưới" riêng. */
  onClose?: () => void;
};

export function PinDetail({ pinId, variant, onClose }: Props) {
  const t = useT();
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
        aria-label={t('pin.loadingAria')}
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 200,
          color: 'var(--color-muted)',
          fontSize: 13.5,
        }}
      >
        {t('common.loading')}
      </div>
    );
  }

  if (state.phase === 'error') {
    const message =
      state.state.kind === 'not-found'
        ? t('pin.notFound')
        : state.state.kind === 'network'
          ? t('pin.serverUnreachable')
          : t('pin.loadFailed');
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
            {t('common.close')}
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
        {t('pin.notFound')}
      </div>
    );
  }

  return (
    <PinDetailContent
      pin={pin}
      variant={variant}
      onClose={onClose}
      refetchPin={() => query.refetch()}
    />
  );
}

function PinDetailContent({
  pin,
  variant,
  onClose,
  refetchPin,
}: {
  pin: NonNullable<PinQuery['pin']>;
  variant: Variant;
  onClose?: () => void;
  /**
   * FE-11 — `pin` tới đây qua prop nên component này KHÔNG có `refetch` của
   * riêng nó; nguồn query nằm ở `PinDetail` phía trên. Khuôn `refetchProfile`
   * của `profile-view.tsx` — truyền hàm đọc lại xuống.
   *
   * Bắt buộc, không phải tuỳ chọn: cạnh nút Theo dõi là `creator.followerCount`
   * và hàng cảm xúc đọc `viewerReaction`. Chỉ set state cục bộ thì chữ nút đổi
   * mà số follower đứng im — sai ngay trên cùng một dòng.
   */
  refetchPin: () => Promise<unknown>;
}) {
  const t = useT();
  const isModal = variant === 'modal';
  const [optimisticSaved, setOptimisticSaved] = useState<boolean | null>(null);
  const [optimisticFollow, setOptimisticFollow] = useState<boolean | null>(null);
  /**
   * FE-11 — ba trạng thái, KHÔNG phải hai. `null` = "không có optimistic, đọc
   * server"; `'NONE'` = "optimistic: vừa GỠ cảm xúc". Bản FE-4 dùng `null` cho cả
   * hai nghĩa (`setOptimisticReaction(active ? null : r)`) và sống được đúng vì
   * `viewerReaction` của server luôn `null` — chưa ai ghi. Nay có ghi thật: nếu
   * giữ `null` làm nghĩa "vừa gỡ" thì `optimisticReaction ?? pin.viewerReaction`
   * rơi ngay về giá trị CŨ của server, nút sáng lại trong lúc chờ mạng.
   */
  const [optimisticReaction, setOptimisticReaction] = useState<ReactionType | 'NONE' | null>(null);
  const { status: sessionStatus } = useSession();
  const { openAuthPrompt } = useAuthPrompt();
  const { openBoardPicker } = useBoardPicker();
  const toast = useToast();
  const [savePin] = useMutation<SavePinMutation, SavePinMutationVariables>(SavePinDocument);
  const [unsavePin] = useMutation<UnsavePinMutation, UnsavePinMutationVariables>(UnsavePinDocument);
  const [saveBusy, setSaveBusy] = useState(false);
  const [toggleReactionM] = useMutation(TogglePinReactionDocument);
  const [followM] = useMutation(FollowDocument);
  const [unfollowM] = useMutation(UnfollowDocument);
  const [reactionBusy, setReactionBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const router = useRouter();
  const confirm = useConfirm();
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: sessionStatus !== 'authenticated' });
  const [deletePin] = useMutation<DeletePinMutation, DeletePinMutationVariables>(DeletePinDocument);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwner = meQuery.data?.me?.id != null && meQuery.data.me.id === pin.creator.id;

  /**
   * F2 · XH-ARCHIVE — pin trong KHO mở ra vẫn là màn này (spec §1 trạng thái 3:
   * "như chi tiết pin thường + nút Đăng lại + giữ nút xoá"). Không có màn chi
   * tiết thứ hai bên trong tab Kho.
   *
   * Điều kiện hiện nút: chính chủ VÀ mốc hết hạn đã qua. Không đọc "đang ở tab
   * Kho" — cùng một pin mở từ link trực tiếp cũng phải đăng lại được, và một
   * điều kiện dựa vào đường đi thì sai ngay lần đầu ai đó gửi link cho chính họ.
   *
   * `Date.now()` ở đây KHÔNG gây lệch hydration: `pin` tới từ Apollo (client),
   * nên lượt render server không bao giờ chạy tới nhánh này.
   */
  const isExpired =
    pin.expiresAt != null && new Date(pin.expiresAt).getTime() <= Date.now();
  const canRepublish = isOwner && isExpired;
  const [republishM] = useMutation<RepublishPinMutation, RepublishPinMutationVariables>(
    RepublishPinDocument,
  );
  const [republishBusy, setRepublishBusy] = useState(false);
  // Tên vòng chỉ cần cho MỘT câu trong hộp xác nhận ⇒ chỉ chủ pin CIRCLE đã hết
  // hạn mới tra. `includeAdHoc: true` vì pin có thể thuộc một vòng tại chỗ —
  // vòng đó ẩn khỏi mọi danh sách chọn nhưng vẫn phải dịch được id sang tên.
  const republishCircleQuery = useQuery<MyCirclesQuery, MyCirclesQueryVariables>(
    MyCirclesDocument,
    {
      variables: { includeAdHoc: true },
      skip: !canRepublish || pin.visibility !== Visibility.Circle,
      fetchPolicy: 'cache-first',
    },
  );

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
   * ✅ DEBT-1b b4 (17/08/2026) — TODO(FE-10) ở đây ĐÃ ĐÓNG.
   *
   * Nó chặn vì **thiếu bản vẽ**, không vì thiếu code: `Panacea-v2.1.html` chỉ vẽ
   * Ô NHẬP "Link nguồn" ở form tạo/sửa pin (B4/B5), không có link nguồn bấm được
   * ở màn xem, và thêm đại một cái = bịa giao diện (luật 19). User chốt 17/08:
   * dựng **một dòng "Nguồn: `<domain>`" dưới dải tag, chỉ bản page** ⇒ nay đã có
   * bề mặt, và `trackPinClick` gắn vào đúng cú bấm đó (xem `sourceRow` bên dưới).
   */
  const [trackView] = useMutation(TrackPinViewDocument);
  const [trackClick] = useMutation(TrackPinClickDocument);
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
  const currentReaction: ReactionType | null =
    optimisticReaction === null
      ? (pin.viewerReaction ?? null)
      : optimisticReaction === 'NONE'
        ? null
        : optimisticReaction;
  const imgUrl = pickDetailImageUrl(pin);
  const title = pin.title || pin.description || t('pin.untitled');
  const description = pin.description ?? '';
  const followerLabel = formatFollowerCount(pin.creator.followerCount);
  const authorName = pin.creator.name || pin.creator.username || t('pin.someUser');

  // Pill "Lưu vào bảng ▾" → mở BoardPicker (save mode). Khách → AuthPrompt.
  const openPicker = () => {
    if (sessionStatus === 'unauthenticated') {
      openAuthPrompt('auth.actionSavePin');
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
      openAuthPrompt('auth.actionSavePin');
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
          message: t('pin.unsaved'),
          action: { label: t('pin.undo'), onClick: () => void resaveQuiet() },
        });
      }
    } catch {
      setOptimisticSaved(!next);
      toast({ message: t('pin.saveFailed') });
    } finally {
      setSaveBusy(false);
    }
  };

  /**
   * FE-11 — hàng cảm xúc. Trước đợt này `onClick` chỉ `setOptimisticReaction`,
   * nên MỌI cảm xúc trên toàn sản phẩm là trang trí: bấm đổi màu, F5 là mất.
   *
   * Ngữ nghĩa toggle nằm ở `pins.service.ts:435-469`, ba nhánh, unique
   * `userId_pinId` ⇒ **mỗi người tối đa MỘT cảm xúc / pin**:
   *   • chưa có          → ADDED   (+ Notification cho chủ pin)
   *   • có, CÙNG loại    → REMOVED
   *   • có, KHÁC loại    → UPDATED (không sinh bản ghi thứ hai)
   *
   * 🟢 **DEBT-1a / B-19 (17/08/2026) — `refetchPin()` đã gỡ.** Trước đó resolver
   * vứt `{success,status}` và luôn trả `true`, nên FE không có cách nào biết con
   * số mới ngoài việc hỏi lại cả pin ⇒ **2 request mỗi lần bấm**. Mutation nay
   * trả `Pin!` kèm `{ id reactionCount viewerReaction }`, Apollo chuẩn hoá theo
   * `id` ⇒ cache entry mà lưới + modal + trang chi tiết đang cùng đọc tự đúng.
   *
   * Optimistic **giữ nguyên** và vẫn cần: nó phục vụ độ nhạy trong khoảnh khắc
   * chờ mạng, không phải để bù dữ liệu thiếu. Sentinel `'NONE'` cũng giữ — `null`
   * ở biến này nghĩa là "không có optimistic", khác hẳn "đã gỡ cảm xúc" (bug đã
   * vá ở FE-11).
   *
   * Thứ tự bắt buộc: optimistic → mutate → **rồi mới** xoá optimistic. Xoá sớm
   * ⇒ nút nhấp nháy về trạng thái cũ trong khoảnh khắc chờ mạng.
   */
  const onReaction = async (r: ReactionType) => {
    // `!== 'authenticated'` chứ không `=== 'unauthenticated'`: mutation có
    // `GqlAuthGuard`, gửi khi phiên chưa rõ là chắc chắn ăn Unauthorized. Khuôn
    // `runFollow` của profile-view. Hệ quả nghiệm thu được (T2.4): khách bấm ⇒
    // KHÔNG có request `togglePinReaction` nào bay ra.
    if (sessionStatus !== 'authenticated') {
      openAuthPrompt('auth.actionReact');
      return;
    }
    // Bấm liên tiếp không có guard sẽ ĐUA NHAU: kết quả cuối phụ thuộc thứ tự
    // response chứ không phải thứ tự bấm.
    if (reactionBusy) return;
    const removing = currentReaction === r;
    setOptimisticReaction(removing ? 'NONE' : r);
    setReactionBusy(true);
    try {
      await toggleReactionM({ variables: { pinId: pin.id, type: r } });
      setOptimisticReaction(null);
    } catch {
      // Hoàn nguyên = bỏ optimistic để rơi về sự thật của server (không đổi).
      setOptimisticReaction(null);
      toast({ message: t('pin.reactFailed') });
    } finally {
      setReactionBusy(false);
    }
  };

  // Theo dõi lại sau Hoàn tác — im lặng, khuôn `silentFollow` của profile-view.
  const refollowQuiet = async () => {
    setOptimisticFollow(true);
    try {
      await followM({ variables: { userId: pin.creator.id } });
      await refetchPin();
      setOptimisticFollow(null);
    } catch {
      setOptimisticFollow(null);
    }
  };

  /**
   * FE-11 — nút Theo dõi. Cùng nút này đã nối thật ở C1 (`profile-view`), C3
   * (`follows-view`), D1 và B1; chỉ màn chi tiết pin còn giả (`setOptimisticFollow`).
   *
   * `refetchPin()` không phải cho riêng cái nút: `creator.followerCount` render
   * ngay dòng trên (`formatFollowerCount`) nên thiếu refetch là chữ nút đổi mà số
   * follower đứng im.
   */
  const toggleFollow = async () => {
    if (sessionStatus !== 'authenticated') {
      openAuthPrompt('auth.actionFollow');
      return;
    }
    if (followBusy) return;
    const next = !isFollowed;
    setOptimisticFollow(next);
    setFollowBusy(true);
    try {
      if (next) {
        await followM({ variables: { userId: pin.creator.id } });
      } else {
        await unfollowM({ variables: { userId: pin.creator.id } });
      }
      await refetchPin();
      setOptimisticFollow(null);
      toast(
        next
          ? { message: t('pin.nowFollowing', { name: authorName }) }
          : {
              message: t('pin.unfollowed', { name: authorName }),
              action: { label: t('pin.undo'), onClick: () => void refollowQuiet() },
            },
      );
    } catch {
      setOptimisticFollow(null);
      toast({ message: t('pin.followFailed') });
    } finally {
      setFollowBusy(false);
    }
  };

  /**
   * FE-11 — nút Chia sẻ (CHỈ có ở bản trang, xem `!isModal` ở headerRow).
   * Khuôn `board-view.tsx:116-124`. `navigator.clipboard` cần secure context —
   * `localhost` đạt nên nhánh `catch` khó chạm tay khi dev; vẫn giữ vì đó là
   * đường sống trên HTTP thật (toast chính URL để người dùng tự chép).
   */
  const share = async () => {
    const url = `${window.location.origin}/pin/${pin.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ message: t('pin.linkCopied') });
    } catch {
      toast({ message: url });
    }
  };

  const onEditPin = () => {
    setMenuOpen(false);
    router.push(`/pin/${pin.id}/edit`);
  };

  const onDeletePin = async () => {
    setMenuOpen(false);
    const ok = await confirm({
      title: t('pin.deleteTitle', { title: pin.title?.trim() || t('pin.thisPin') }),
      body: t('pin.deleteBody'),
      yesLabel: t('pin.deleteYes'),
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
      toast({ message: t('pin.deleted') });
      router.push('/');
    } catch {
      toast({ message: t('pin.deleteFailed') });
    }
  };

  /**
   * Đăng lại = gỡ hạn sống. CÓ confirm (QĐ-24) và nội dung phải nêu rõ hai điều
   * bản vẽ chốt từng chữ: AI sẽ thấy lại, và pin về ĐÚNG CHỖ CŨ THEO NGÀY ĐĂNG
   * GỐC. Vế thứ hai không phải câu trấn an — backend cố ý không đụng
   * `createdAt` (`PinsService.republishPin`), nên nếu người dùng tưởng pin sẽ
   * nhảy lên đầu feed thì họ sẽ đi tìm nó ở sai chỗ.
   *
   * `refetchPin()` chứ không set state cục bộ: nút này biến mất khi `expiresAt`
   * về `null`, mà cờ đó nằm trong chính `pin` — cùng lý do đã ghi ở docblock
   * `refetchPin` phía trên.
   */
  const onRepublish = async () => {
    if (republishBusy) return;
    const circleName = circleDisplayName(
      t,
      republishCircleQuery.data?.myCircles.find((c) => c.id === pin.audienceCircleId),
    );
    const ok = await confirm({
      title: t('archive.republishConfirmTitle', {
        title: pin.title?.trim() || t('pin.thisPin'),
      }),
      body: t('archive.republishConfirmBody', {
        audience: republishAudienceName(t, pin.visibility, circleName),
      }),
      yesLabel: t('archive.republish'),
    });
    if (!ok) return;
    setRepublishBusy(true);
    try {
      await republishM({
        variables: { id: pin.id },
        // Kho đọc qua `archivedPins` — một field GỐC khác hẳn `pin(id)`, nên
        // `expiresAt: null` trả về từ mutation cập nhật đúng entry Pin mà
        // KHÔNG rút pin ra khỏi danh sách kho: danh sách là một mảng con trỏ
        // do server dựng, Apollo không có cách nào biết điều kiện lọc của nó.
        // Đá cả field đi để lần đọc kho kế tiếp phải hỏi lại server.
        update: (cache) => {
          cache.evict({ id: 'ROOT_QUERY', fieldName: 'archivedPins' });
          cache.gc();
        },
      });
      await refetchPin();
      toast({ message: t('archive.republished') });
    } catch {
      toast({ message: t('archive.republishFailed') });
    } finally {
      setRepublishBusy(false);
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
            aria-label={t('common.close')}
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
            {t('pin.closeEscHint')}
          </div>
        </>
      ) : (
        <>
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label={t('pin.moreOptions')}
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
                  {t('pin.edit')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void onDeletePin()}
                  style={{ textAlign: 'left', padding: '9px 12px', border: 'none', background: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, borderRadius: 8, width: '100%' }}
                >
                  {t('pin.deleteYes')}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void share()}
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
            {t('pin.share')}
          </button>
        </>
      )}
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={openPicker}
        aria-label={t('pin.pickBoardAria')}
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
        {t('pin.saveToBoard')}
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
        {isSaved ? t('pin.saved') : t('pin.save')}
      </button>
    </div>
  );

  const reactionsRow = (
    <div
      role="group"
      aria-label={t('pin.pickReactionAria')}
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
            title={t(REACTION_LABEL_KEY[r])}
            onClick={() => void onReaction(r)}
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
            <span>{t(REACTION_LABEL_KEY[r])}</span>
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

  /**
   * DEBT-1b b4 — dòng "Nguồn: `<domain>`", **chỉ bản page** (✅⑤).
   *
   * Đặt ngay sau `tagsRow` vì `tagsRow` cũng page-only ⇒ hai khối cùng điều kiện
   * nằm cạnh nhau, không sinh thêm một nhánh `!isModal` rời rạc ở chỗ khác.
   *
   * `pin.sourceUrl` là **chữ người dùng nhập**, nên `new URL()` phải bọc
   * try/catch: một giá trị không parse được sẽ ném và làm trắng cả màn xem pin.
   * Không parse được ⇒ **không render gì**, giống hệt nhánh `null`.
   *
   * 🔴 `trackPinClick` **fire-and-forget, KHÔNG chặn điều hướng.** Không
   * `preventDefault`, không `await` trước khi mở link: `<a target="_blank">` chạy
   * theo nhịp của trình duyệt, còn mutation đi đường của nó. Boolean trả về là
   * *"lần này có tăng bộ đếm không"* — `false` là **bình thường** (debounce 30
   * phút, hoặc pin không có `sourceUrl`), **không** phải mã lỗi ⇒ không toast,
   * không render theo kết quả. Một phép đo hụt không được làm hỏng cú bấm.
   *
   * 📌 Seed chỉ **3/20 pin** có `sourceUrl` (`pin_1_id` · `pin_2_id` · `pin_9_id`).
   * Pin khác không hiện dòng này — **đúng, không phải bug**.
   */
  let sourceHost: string | null = null;
  if (!isModal && pin.sourceUrl) {
    try {
      sourceHost = new URL(pin.sourceUrl).hostname;
    } catch {
      sourceHost = null;
    }
  }

  const sourceRow =
    sourceHost && pin.sourceUrl ? (
      <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 20 }}>
        {t('pin.source')}{' '}
        <a
          href={pin.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            void trackClick({ variables: { pinId: pin.id } }).catch(() => {
              // Im lặng — xem khối "fire-and-forget" ở trên.
            });
          }}
          style={{ color: 'var(--color-primary-strong)', fontWeight: 600 }}
        >
          {sourceHost}
        </a>
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
      <UserLink
        username={pin.creator.username}
        title={authorName}
        testId="pin-author-avatar"
        style={{ display: 'flex', flex: 'none' }}
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
      </UserLink>
      <div style={{ minWidth: 0 }}>
        <UserLink username={pin.creator.username} testId="pin-author-name">
          <div
            style={{
              fontWeight: 700,
              fontSize: isModal ? 13.5 : 14,
              color: 'var(--color-foreground)',
            }}
          >
            {authorName}
          </div>
        </UserLink>
        {!isModal && followerLabel && (
          <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            {t('pin.followerCount', {
              count: pin.creator.followerCount ?? 0,
              countText: followerLabel,
            })}
          </div>
        )}
      </div>
      <div style={{ flex: 1 }} />
      {/*
        FE-11 — ẩn nút khi xem pin CỦA CHÍNH MÌNH. Backend chặn cứng
        (`social.service.ts:26` → `Cannot follow yourself`) nên để nút ở đây là
        một nút bảo đảm lỗi. Không phải bịa giao diện: bản vẽ Panacea chỉ vẽ pin
        của người khác, không có trạng thái "pin của tôi", và tiền lệ trong app
        là ẩn (C1a của `profile-view.tsx:323` đổi sang "Sửa hồ sơ" khi `isSelf`).
        Cùng file này FE-10 cũng đã render menu ⋯ theo `isOwner`.
      */}
      {!isOwner && (
        <button
          type="button"
          aria-pressed={isFollowed}
          onClick={() => void toggleFollow()}
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
          {isFollowed ? t('pin.following') : t('pin.follow')}
        </button>
      )}
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
          {sourceRow}
        </>
      )}

      {authorRow}

      {/* XH-ARCHIVE — Đăng lại. Đặt NGAY DƯỚI hàng tác giả, trên khối "ai đã
          xem" và bình luận, đúng thứ tự bản vẽ dựng cho chi tiết pin trong kho
          (ảnh · tiêu đề · meta · [Đăng lại] [Xoá] · bình luận). Nút Xoá không
          nhân bản ở đây — nó đã sống trong menu ⋯ cho mọi pin của chính chủ,
          và bản vẽ yêu cầu "GIỮ nút xoá", không phải "thêm nút xoá thứ hai". */}
      {canRepublish && (
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', paddingTop: 16 }}>
          <button
            type="button"
            data-testid="pin-republish"
            disabled={republishBusy}
            onClick={() => void onRepublish()}
            style={{
              padding: '11px 20px',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background: 'var(--color-primary)',
              color: 'var(--color-primary-foreground)',
              fontWeight: 700,
              fontSize: 13.5,
              cursor: republishBusy ? 'default' : 'pointer',
              opacity: republishBusy ? 0.6 : 1,
            }}
          >
            {t('archive.republish')}
          </button>
        </div>
      )}

      <PinViewersRow pinId={pin.id} visibility={pin.visibility} isOwner={isOwner} />

      <div style={{ paddingTop: 16 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: isModal ? 14 : 14.5,
            marginBottom: 12,
            color: 'var(--color-foreground)',
          }}
        >
          {t('pin.comments')}
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
            {t('pin.openFullPage')}
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
