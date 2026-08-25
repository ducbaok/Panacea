'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  BoardDocument,
  type BoardQuery,
  type BoardQueryVariables,
  MeDocument,
  type MeQuery,
  InviteCollaboratorDocument,
  InviteCircleToBoardDocument,
  type InviteCircleToBoardMutation,
  type InviteCircleToBoardMutationVariables,
  RemoveCollaboratorDocument,
  UpdateCollaboratorRoleDocument,
  CollaboratorRole,
  MyCirclesDocument,
  type MyCirclesQuery,
  type MyCirclesQueryVariables,
} from '@/lib/gql/graphql';
import { useSearchUsers } from '@/lib/hooks/usePaginatedQuery';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatCount } from '@/lib/format';
import { boardErrorKey } from '@/lib/errors/board-error';
import { useT } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n/translate';

/**
 * C7 — Cộng tác viên (FE-10, view=collabs). Route `/board/[id]/collaborators`.
 *
 * ─── Hợp đồng API đã đo, khác bản vẽ ở 3 chỗ (§4.5 / §4.7) ───
 *
 * 1. `data-op="searchUsers"` của bản vẽ KHÔNG có thật ⇒ dùng
 *    `search(query, type: USER)` (hook `useSearchUsers`, đã có từ FE-8).
 * 2. `data-op="boardCollaborators"` cũng không có ⇒ danh sách nạp qua
 *    `board(id).collaborators`, và vì thế **KHÔNG phân trang** — trả trọn mảng.
 * 3. **Không có mutation `leaveBoard`.** Nút "Rời board" gọi CHÍNH
 *    `removeCollaborator(boardId, userId: <chính mình>)`; backend cho phép vì
 *    `userId === collabUserId`. Nút "Gỡ" của chủ board gọi cùng mutation với
 *    userId người khác. Một mutation, hai nút, hai ý nghĩa.
 *
 * ─── Hai quyết định của đợt (bản vẽ không định, §4.5 bẫy 10) ───
 *
 * • **Chủ board hiện thành một hàng riêng, nhãn "Chủ board"**, không có `<select>`
 *   và không có nút Gỡ. Lý do: owner KHÔNG nằm trong `board.collaborators` (owner
 *   là `board.user`), nên nếu không vẽ riêng thì màn "N người trong board" lại
 *   thiếu đúng người quan trọng nhất.
 * • **N ĐẾM CẢ chủ board** (`collaborators.length + 1`) — heading bản vẽ là "N
 *   người trong board", mà chủ board rõ ràng ở trong board.
 *
 * ─── XH-BOARD-CIRCLE (24/08, luồng D) — mời NGUYÊN VÒNG ───
 * Khối "Mời cả vòng tròn" nằm NGAY TRONG màn này chứ không phải một màn riêng:
 * bản vẽ vẽ nó như một khối thêm của C7, và lời mời vòng "nở" thành đúng những
 * `CollaboratorRow` mà danh sách bên dưới đang hiển thị (XH-QĐ-17).
 *
 * ⚠️ MỘT CHỖ CỐ Ý KHÁC BẢN VẼ: bản vẽ hiện câu "3/5 đã có mặt" NGAY TRONG
 * picker, tức trước khi bấm Mời. FE KHÔNG biết con số đó trước: `myCircles`
 * chỉ trả `memberCount`, còn ai trong vòng đã là cộng tác viên thì phải đối
 * chiếu từng thành viên — một query `circle(id)` nữa cho MỖI vòng, và vẫn có
 * thể lệch nếu ai đó đổi danh sách giữa chừng. Nên câu đếm hiện SAU khi mời,
 * lấy đúng ba con số backend trả về (QĐ-25) — đó là con số THẬT của thao tác
 * vừa xảy ra, không phải một ước lượng.
 *
 * ─── Trạng thái thứ 6 ngoài bản vẽ, cố ý ───
 * Bản vẽ có 5 trạng thái (idle/notfound/owneronly/self/neterr) × 2 biến thể vai
 * trò, tất cả đều giả định người xem LÀ chủ board hoặc cộng tác viên. Nhưng route
 * này gõ tay URL vào được: một người đăng nhập bất kỳ mở
 * `/board/<board người khác>/collaborators` phải ra cái gì đó. Ở đây trả `denied`
 * với chuỗi Việt đã duyệt của "You do not have editor access to this board" —
 * KHÔNG dựng màn quản lý cho người ngoài, và cũng không crash.
 */

type C7State = 'idle' | 'notfound' | 'owneronly' | 'self' | 'neterr' | 'denied';

export function CollaboratorsView({ boardId }: { boardId: string }) {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { status: sessionStatus } = useSession();

  const boardQuery = useQuery<BoardQuery, BoardQueryVariables>(BoardDocument, {
    variables: { id: boardId },
  });
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: sessionStatus !== 'authenticated' });

  const [inviteM] = useMutation(InviteCollaboratorDocument);
  const [inviteCircleM] = useMutation<
    InviteCircleToBoardMutation,
    InviteCircleToBoardMutationVariables
  >(InviteCircleToBoardDocument);
  const [removeM] = useMutation(RemoveCollaboratorDocument);
  const [roleM] = useMutation(UpdateCollaboratorRoleDocument);

  const board = boardQuery.data?.board;
  const meId = meQuery.data?.me?.id ?? null;
  const owner = board?.user ?? null;
  const isOwner = !!meId && !!owner && owner.id === meId;

  // `BoardCollaborator.user` nullable ở SDL ⇒ lọc null trước khi dựng hàng.
  const collaborators = useMemo(
    () =>
      (board?.collaborators ?? []).filter(
        (c): c is typeof c & { user: NonNullable<typeof c.user> } => c.user != null,
      ),
    [board?.collaborators],
  );
  const isCollaborator = !!meId && collaborators.some((c) => c.user.id === meId);

  const [state, setState] = useState<C7State>('idle');
  const [bannerOverride, setBannerOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ─── Mời cả vòng (XH-BOARD-CIRCLE) ────────────────────────────────────────
  // `skip: !isOwner` — chỉ chủ board mới mời được, và `myCircles` là danh sách
  // riêng tư: đừng bắn query đó ra từ màn của một cộng tác viên.
  const circlesQuery = useQuery<MyCirclesQuery, MyCirclesQueryVariables>(MyCirclesDocument, {
    variables: { includeAdHoc: false },
    skip: !isOwner,
  });
  const myCircles = circlesQuery.data?.myCircles ?? [];
  const [circlePickerOpen, setCirclePickerOpen] = useState(false);
  const [pickedCircleId, setPickedCircleId] = useState<string | null>(null);
  const [circleRole, setCircleRole] = useState<CollaboratorRole>(CollaboratorRole.Editor);
  /** Kết quả lần mời vòng gần nhất — nguồn của cả câu đếm lẫn danh sách "vừa thêm". */
  const [circleResult, setCircleResult] = useState<
    (InviteCircleToBoardMutation['inviteCircleToBoard'] & { circleName: string }) | null
  >(null);

  // Ô tìm người: gõ 300ms mới gọi `search` (mỗi ký tự một request là vô lý).
  const [rawQuery, setRawQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(rawQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [rawQuery]);
  const searchResults = useSearchUsers(
    { query: debounced, first: 20 },
    { skip: !isOwner || debounced === '' },
  );

  const canManage = isOwner || isCollaborator;
  const effectiveState: C7State = board && !canManage ? 'denied' : state;

  const bannerText = ((): string | null => {
    if (bannerOverride) return bannerOverride;
    switch (effectiveState) {
      case 'owneronly':
        return t('errors.board.onlyOwnerInvites');
      case 'self':
        return t('errors.board.cannotInviteSelf');
      case 'neterr':
        return t('board.collabLoadFailed');
      case 'denied':
        return t('errors.board.noEditPermission');
      default:
        return null;
    }
  })();

  /**
   * i18n (23/08/2026) — `fallback` nay là KEY, không phải chữ: chuỗi lạ từ
   * backend rơi về câu dự phòng của MÀN, và câu đó cũng phải đổi theo ngôn ngữ.
   */
  function showError(err: unknown, fallbackKey: TranslationKey) {
    const raw = err instanceof Error ? err.message : '';
    const key = boardErrorKey(raw);
    setBannerOverride(t(key ?? fallbackKey));
    setState('neterr');
  }

  async function onInvite(user: { id: string; name?: string | null; username?: string | null }) {
    if (!isOwner || busy) {
      if (!isOwner) setState('owneronly');
      return;
    }
    // Tự mời chính mình: backend ném "Cannot invite yourself"; chặn trước ở đây
    // để khỏi tốn round-trip, banner vẫn là đúng chuỗi Việt đã duyệt của lỗi đó.
    if (user.id === meId) {
      setBannerOverride(null);
      setState('self');
      return;
    }
    setBannerOverride(null);
    setBusy(true);
    try {
      // Mời vào với vai trò EDITOR: đây là màn "cộng tác", và VIEWER đổi được
      // ngay bằng <select> ở hàng bên dưới.
      await inviteM({
        variables: { boardId, userId: user.id, role: CollaboratorRole.Editor },
      });
      setState('idle');
      await boardQuery.refetch();
      toast({
        message: t('board.collabAdded', { name: user.name || `@${user.username ?? ''}` }),
      });
    } catch (err) {
      showError(err, 'board.inviteFailed');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Mời NGUYÊN VÒNG. Một mutation, backend tự bỏ qua người đã có mặt (QĐ-25) —
   * FE KHÔNG tự lọc trước: danh sách cộng tác viên trên màn có thể cũ vài giây,
   * và lọc theo bản cũ thì bỏ sót đúng người vừa bị gỡ ở tab khác.
   */
  async function onInviteCircle() {
    const circle = myCircles.find((c) => c.id === pickedCircleId);
    if (!isOwner || busy || !circle) return;
    setBannerOverride(null);
    setBusy(true);
    try {
      const res = await inviteCircleM({
        variables: { boardId, circleId: circle.id, role: circleRole },
      });
      const data = res.data?.inviteCircleToBoard;
      if (data) setCircleResult({ ...data, circleName: circle.name });
      setState('idle');
      await boardQuery.refetch();
      if (data && data.addedCount > 0) {
        toast({
          message: t('board.inviteCircleAdded', {
            count: data.addedCount,
            countText: formatCount(data.addedCount),
            name: circle.name,
          }),
        });
      }
    } catch (err) {
      showError(err, 'board.inviteCircleFailed');
    } finally {
      setBusy(false);
    }
  }

  async function onChangeRole(userId: string, role: CollaboratorRole) {
    if (!isOwner || busy) return;
    setBannerOverride(null);
    setBusy(true);
    try {
      await roleM({ variables: { boardId, userId, role } });
      setState('idle');
      await boardQuery.refetch();
    } catch (err) {
      showError(err, 'board.roleChangeFailed');
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(user: { id: string; name?: string | null; username?: string | null }) {
    if (!isOwner || busy) return;
    const label = user.name || `@${user.username ?? ''}`;
    const ok = await confirm({
      title: t('board.removeTitle', { name: label }),
      body: t('board.removeBody'),
      yesLabel: t('board.removeYes'),
      danger: true,
    });
    if (!ok) return;
    setBannerOverride(null);
    setBusy(true);
    try {
      await removeM({ variables: { boardId, userId: user.id } });
      await boardQuery.refetch();
      // Không Hoàn tác: mời lại là một hành động khác (tạo lại quan hệ), không
      // phải phép đảo của gỡ — luật toast.
      toast({ message: t('board.removed', { name: label }) });
    } catch (err) {
      showError(err, 'board.removeFailed');
    } finally {
      setBusy(false);
    }
  }

  /** "Rời board" = removeCollaborator với userId CHÍNH MÌNH (§4.7). */
  async function onLeave() {
    if (!meId || busy) return;
    const ok = await confirm({
      title: t('board.leaveTitle'),
      body: t('board.leaveBody'),
      yesLabel: t('board.leaveYes'),
      danger: true,
    });
    if (!ok) return;
    setBannerOverride(null);
    setBusy(true);
    try {
      await removeM({ variables: { boardId, userId: meId } });
      toast({ message: t('board.leftBoard') });
      router.push(`/board/${boardId}`);
    } catch (err) {
      showError(err, 'board.leaveFailed');
    } finally {
      setBusy(false);
    }
  }

  if (boardQuery.loading && !board) {
    return <Centered>{t('board.loadingBoard')}</Centered>;
  }
  if (boardQuery.error || !board) {
    return (
      <Centered>
        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-foreground)' }}>
          {t('board.notFoundTitle')}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>
          {t('board.notFoundBody')}
        </div>
      </Centered>
    );
  }

  const memberCount = collaborators.length + (owner ? 1 : 0);
  const subtitle = isOwner
    ? t('board.ownerHint')
    : t('board.collabHint');

  /**
   * Người đã ở trong board thì nút Mời khoá lại (guard §4.6 — mời trùng làm
   * backend ném Prisma P2002 thô vì @@unique([boardId,userId])).
   *
   * ⚠️ CỐ Ý không khoá nút cho CHÍNH MÌNH, dù chủ board hiển nhiên "đã ở trong
   * board": khoá luôn thì trạng thái "4 Mời chính mình" của bản vẽ thành không
   * thể chạm tới, và người dùng nhận thông điệp sai ("đã ở trong board" thay vì
   * "không thể tự mời chính mình"). Bấm vào sẽ vào nhánh `self` → banner đúng.
   */
  const inBoardIds = new Set<string>([
    ...(owner ? [owner.id] : []),
    ...collaborators.map((c) => c.user.id),
  ]);

  return (
    <div
      style={{ padding: '24px 16px 40px' }}
      data-screen="C7"
      data-state={`${isOwner ? 'owner' : isCollaborator ? 'collab' : 'outsider'}-${effectiveState}`}
    >
      <button
        type="button"
        onClick={() => router.push(`/board/${boardId}`)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--color-muted)', fontWeight: 600, padding: 0, marginBottom: 14 }}
      >
        ← {t('board.backToBoard')}
      </button>

      <h1 style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 24, margin: '0 0 4px', color: 'var(--color-foreground)' }}>
        {t('board.collaborators')}
      </h1>
      {canManage && (
        <p style={{ fontSize: 13.5, color: 'var(--color-muted)', margin: '0 0 18px' }}>{subtitle}</p>
      )}

      <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {bannerText && (
          <div
            role="alert"
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: '11px 14px',
              borderRadius: 12,
              background: 'var(--color-surface-muted)',
              color: 'var(--color-danger)',
              border: '1px solid var(--color-border)',
              lineHeight: 1.6,
            }}
          >
            {bannerText}
          </div>
        )}

        {/* Card "Mời người vào board" — CHỈ chủ board thấy (bản vẽ: display:none
            ở biến thể cộng tác viên). */}
        {isOwner && (
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 18,
              padding: 22,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: 'var(--color-foreground)' }}>
              {t('board.invitePeople')}
            </div>
            <input
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder={t('board.invitePlaceholder')}
              aria-label={t('board.inviteSearchAria')}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '11px 14px',
                borderRadius: 12,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface-muted)',
                color: 'var(--color-foreground)',
                fontSize: 13.5,
                outline: 'none',
              }}
            />
            {/* Mời bằng userId nên không có ô email — chép ý bản vẽ. */}
            <div style={{ fontSize: 11.5, color: 'var(--color-muted)', lineHeight: 1.6, marginTop: 10 }}>
              {t('board.inviteNoPending')}
            </div>

            {debounced !== '' && searchResults.loading && searchResults.items.length === 0 && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--color-muted)' }}>{t('board.searching')}</div>
            )}

            {debounced !== '' && !searchResults.loading && searchResults.items.length === 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: 16,
                  borderRadius: 12,
                  background: 'var(--color-surface-muted)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--color-foreground)' }}>
                  {t('board.noPeopleMatch', { query: debounced })}
                </div>
                {/* Bản vẽ gõ sai "hoạc" — sửa thành "hoặc" (§0c, đã duyệt). */}
                <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 4 }}>
                  {t('board.tryAnotherName')}
                </div>
              </div>
            )}

            {searchResults.items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                {searchResults.items.map((u) => {
                  const already = u.id !== meId && inBoardIds.has(u.id);
                  return (
                    <div
                      key={u.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 11,
                        padding: 9,
                        borderRadius: 12,
                        background: 'var(--color-surface-muted)',
                      }}
                    >
                      <Avatar size={36} name={u.name ?? u.username} url={u.avatarUrl} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--color-foreground)' }}>
                          {u.name ?? u.username}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>@{u.username}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onInvite(u)}
                        disabled={already || busy}
                        title={already ? t('board.alreadyMember') : undefined}
                        style={{
                          padding: '8px 16px',
                          borderRadius: 999,
                          border: 'none',
                          background: 'var(--color-primary)',
                          color: 'var(--color-primary-foreground)',
                          fontWeight: 700,
                          fontSize: 12.5,
                          cursor: already || busy ? 'not-allowed' : 'pointer',
                          opacity: already || busy ? 0.5 : 1,
                          flex: 'none',
                        }}
                      >
                        {t('board.invite')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── XH-BOARD-CIRCLE — "Mời cả vòng tròn" (chỉ chủ board) ───
            5 trạng thái của bản vẽ: idle · picker · done · empty · dup.
            `data-state` gộp chúng lại đúng theo tên bản vẽ để soát bằng mắt. */}
        {isOwner && (
          <div
            data-screen="XH-BOARD-CIRCLE"
            data-state={
              myCircles.length === 0
                ? 'empty'
                : circleResult
                  ? circleResult.alreadyCount > 0
                    ? 'dup'
                    : 'done'
                  : circlePickerOpen
                    ? 'picker'
                    : 'idle'
            }
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 18,
              padding: 22,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: 'var(--color-foreground)' }}>
              {t('board.inviteCircleTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14 }}>
              {t('board.inviteCircleBody')}
            </div>

            {myCircles.length === 0 ? (
              /* Trạng thái 3 — chưa có vòng nào. Không vẽ picker rỗng: người
                 dùng cần biết đi đâu để tạo, và rằng mời tay vẫn còn đó. */
              <div
                style={{
                  padding: 22,
                  borderRadius: 14,
                  background: 'var(--color-surface-muted)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-foreground)' }}>
                  {t('board.inviteCircleNoneTitle')}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 6, lineHeight: 1.6 }}>
                  {t('board.inviteCircleNoneBody')}
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setCirclePickerOpen((v) => !v)}
                  aria-expanded={circlePickerOpen}
                  style={{
                    padding: '11px 20px',
                    borderRadius: 999,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface-muted)',
                    color: 'var(--color-foreground)',
                    fontWeight: 700,
                    fontSize: 13.5,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {t('board.inviteCircleOpen')}
                </button>

                {circlePickerOpen && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                    <PickerLabel>{t('board.inviteCirclePickLabel')}</PickerLabel>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {myCircles.map((c) => (
                        <PickerChip
                          key={c.id}
                          active={pickedCircleId === c.id}
                          onClick={() => setPickedCircleId(c.id)}
                          label={t('board.inviteCircleChip', {
                            name: c.name,
                            count: c.memberCount,
                            countText: formatCount(c.memberCount),
                          })}
                        />
                      ))}
                    </div>

                    <PickerLabel style={{ margin: '14px 0 8px' }}>
                      {t('board.inviteCircleRoleLabel')}
                    </PickerLabel>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <PickerChip
                        active={circleRole === CollaboratorRole.Viewer}
                        onClick={() => setCircleRole(CollaboratorRole.Viewer)}
                        label={t('board.roleViewer')}
                      />
                      <PickerChip
                        active={circleRole === CollaboratorRole.Editor}
                        onClick={() => setCircleRole(CollaboratorRole.Editor)}
                        label={t('board.roleEditor')}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => void onInviteCircle()}
                      disabled={busy || pickedCircleId == null}
                      style={{
                        marginTop: 14,
                        padding: '11px 20px',
                        borderRadius: 999,
                        border: 'none',
                        background: 'var(--color-primary)',
                        color: 'var(--color-primary-foreground)',
                        fontWeight: 700,
                        fontSize: 13.5,
                        fontFamily: 'inherit',
                        cursor: busy || pickedCircleId == null ? 'not-allowed' : 'pointer',
                        opacity: busy || pickedCircleId == null ? 0.5 : 1,
                      }}
                    >
                      {t('board.inviteCircleSubmit')}
                    </button>
                  </div>
                )}

                {/* Kết quả — QĐ-25. Bốn nhánh chữ cho bốn tình huống KHÁC NHAU;
                    gộp lại thành một câu thì "cả vòng đã có mặt" và "vòng rỗng"
                    đều hiện thành "đã thêm 0 người", nói sai chuyện đã xảy ra. */}
                {circleResult && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10, lineHeight: 1.55 }}>
                      {circleResult.memberCount === 0
                        ? t('board.inviteCircleEmptyCircle')
                        : circleResult.addedCount === 0
                          ? t('board.inviteCircleAllPresent', { total: circleResult.memberCount })
                          : circleResult.alreadyCount > 0
                            ? t('board.inviteCircleDup', {
                                already: circleResult.alreadyCount,
                                total: circleResult.memberCount,
                                added: circleResult.addedCount,
                              })
                            : t('board.inviteCircleDoneNote', { name: circleResult.circleName })}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {circleResult.added.map((m) => (
                        <div
                          key={m.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 11,
                            padding: 10,
                            borderRadius: 12,
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          <Avatar size={38} name={m.user?.name ?? m.user?.username} url={m.user?.avatarUrl} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--color-foreground)' }}>
                              {m.user?.name ?? m.user?.username}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>@{m.user?.username}</div>
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--color-muted)', fontWeight: 600 }}>
                            {m.role === CollaboratorRole.Editor ? t('board.roleEditor') : t('board.roleViewer')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Danh sách thành viên — hiện cho chủ board và cộng tác viên. */}
        {canManage && (
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 18,
              padding: 22,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: 'var(--color-foreground)' }}>
              {t('board.memberCount', {
                count: memberCount,
                countText: formatCount(memberCount),
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Chủ board: hàng riêng, không select, không nút Gỡ (không ai gỡ
                  được chủ board — backend cũng không có đường đó). */}
              {owner && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: 10,
                    borderRadius: 12,
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <Avatar size={38} name={owner.name ?? owner.username} url={owner.avatarUrl} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--color-foreground)' }}>
                      {owner.name ?? owner.username}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>@{owner.username}</div>
                  </div>
                  <span
                    style={{
                      padding: '6px 12px',
                      borderRadius: 999,
                      background: 'var(--color-surface-muted)',
                      color: 'var(--color-muted)',
                      fontSize: 12,
                      fontWeight: 600,
                      flex: 'none',
                    }}
                  >
                    {t('board.owner')}
                  </span>
                </div>
              )}

              {collaborators.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: 10,
                    borderRadius: 12,
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <Avatar size={38} name={c.user.name ?? c.user.username} url={c.user.avatarUrl} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--color-foreground)' }}>
                      {c.user.name ?? c.user.username}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>@{c.user.username}</div>
                  </div>
                  <select
                    value={c.role}
                    onChange={(e) => void onChangeRole(c.user.id, e.target.value as CollaboratorRole)}
                    disabled={!isOwner || busy}
                    aria-label={t('board.roleOf', { name: c.user.name ?? c.user.username ?? '' })}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid var(--color-border)',
                      background: isOwner ? 'var(--color-surface-muted)' : 'var(--color-surface)',
                      color: isOwner ? 'var(--color-foreground)' : 'var(--color-muted)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      cursor: isOwner ? 'pointer' : 'not-allowed',
                      flex: 'none',
                    }}
                  >
                    <option value="VIEWER">{t('board.roleViewer')}</option>
                    <option value="EDITOR">{t('board.roleEditor')}</option>
                  </select>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => void onRemove(c.user)}
                      disabled={busy}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 999,
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)',
                        color: 'var(--color-danger)',
                        fontWeight: 600,
                        fontSize: 12.5,
                        cursor: busy ? 'not-allowed' : 'pointer',
                        flex: 'none',
                      }}
                    >
                      {t('board.removeYes')}
                    </button>
                  )}
                </div>
              ))}

              {collaborators.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1.6 }}>
                  {t('board.noCollaborators')}
                </div>
              )}
            </div>

            {/* "Rời board" chỉ ở biến thể cộng tác viên — chủ board không rời
                board của chính mình (backend cũng chặn). */}
            {isCollaborator && !isOwner && (
              <button
                type="button"
                onClick={() => void onLeave()}
                disabled={busy}
                style={{
                  marginTop: 16,
                  padding: '11px 20px',
                  borderRadius: 999,
                  border: '1px solid var(--color-danger)',
                  background: 'none',
                  color: 'var(--color-danger)',
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                {t('board.leaveYes')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Nhãn nhóm trong picker vòng — chữ nhỏ, in hoa, theo bản vẽ. */
function PickerLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        color: 'var(--color-muted)',
        marginBottom: 8,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Chip chọn một-trong-nhiều (vòng / vai trò). */
function PickerChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '8px 14px',
        borderRadius: 999,
        border: active ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
        background: active ? 'var(--color-primary-soft)' : 'var(--color-surface-muted)',
        color: active ? 'var(--color-primary-strong)' : 'var(--color-foreground)',
        fontWeight: 600,
        fontSize: 12.5,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Avatar({ size, name, url }: { size: number; name?: string | null; url?: string | null }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? ''}
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
        fontSize: 13,
        flex: 'none',
      }}
    >
      {initial}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 240,
        textAlign: 'center',
        color: 'var(--color-muted)',
        fontSize: 14,
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}
