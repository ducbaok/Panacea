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
  RemoveCollaboratorDocument,
  UpdateCollaboratorRoleDocument,
  CollaboratorRole,
} from '@/lib/gql/graphql';
import { useSearchUsers } from '@/lib/hooks/usePaginatedQuery';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatCount } from '@/lib/format';
import { translateBoardError } from '@/lib/errors/board-error-vi';

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
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { status: sessionStatus } = useSession();

  const boardQuery = useQuery<BoardQuery, BoardQueryVariables>(BoardDocument, {
    variables: { id: boardId },
  });
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: sessionStatus !== 'authenticated' });

  const [inviteM] = useMutation(InviteCollaboratorDocument);
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
        return translateBoardError('Only board owner can invite collaborators');
      case 'self':
        return translateBoardError('Cannot invite yourself');
      case 'neterr':
        return 'Không tải được danh sách cộng tác viên.';
      case 'denied':
        return translateBoardError('You do not have editor access to this board');
      default:
        return null;
    }
  })();

  function showError(err: unknown, fallback: string) {
    const raw = err instanceof Error ? err.message : '';
    setBannerOverride(translateBoardError(raw) ?? fallback);
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
      toast({ message: `Đã thêm ${user.name || `@${user.username ?? ''}`}` });
    } catch (err) {
      showError(err, 'Không mời được người này, thử lại sau.');
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
      showError(err, 'Không đổi được vai trò, thử lại sau.');
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(user: { id: string; name?: string | null; username?: string | null }) {
    if (!isOwner || busy) return;
    const label = user.name || `@${user.username ?? ''}`;
    const ok = await confirm({
      title: `Gỡ ${label} khỏi board?`,
      body: 'Họ sẽ mất quyền sửa board này.',
      yesLabel: 'Gỡ',
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
      toast({ message: `Đã gỡ ${label}` });
    } catch (err) {
      showError(err, 'Không gỡ được cộng tác viên, thử lại sau.');
    } finally {
      setBusy(false);
    }
  }

  /** "Rời board" = removeCollaborator với userId CHÍNH MÌNH (§4.7). */
  async function onLeave() {
    if (!meId || busy) return;
    const ok = await confirm({
      title: 'Rời board này?',
      body: 'Bạn sẽ mất quyền sửa; chủ board có thể mời lại.',
      yesLabel: 'Rời board',
      danger: true,
    });
    if (!ok) return;
    setBannerOverride(null);
    setBusy(true);
    try {
      await removeM({ variables: { boardId, userId: meId } });
      toast({ message: 'Đã rời board' });
      router.push(`/board/${boardId}`);
    } catch (err) {
      showError(err, 'Không rời được board, thử lại sau.');
    } finally {
      setBusy(false);
    }
  }

  if (boardQuery.loading && !board) {
    return <Centered>Đang tải board…</Centered>;
  }
  if (boardQuery.error || !board) {
    return (
      <Centered>
        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-foreground)' }}>
          Không tìm thấy board
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>
          Board có thể đã bị xoá, hoặc bạn không có quyền xem.
        </div>
      </Centered>
    );
  }

  const memberCount = collaborators.length + (owner ? 1 : 0);
  const subtitle = isOwner
    ? 'Bạn là chủ board — mời, đổi vai trò, gỡ người khác.'
    : 'Bạn là cộng tác viên — chỉ xem danh sách.';

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
        ← Quay lại board
      </button>

      <h1 style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 24, margin: '0 0 4px', color: 'var(--color-foreground)' }}>
        Cộng tác viên
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
              Mời người vào board
            </div>
            <input
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder="Gõ tên hoặc @username"
              aria-label="Tìm người để mời"
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
              Mời xong vào thẳng danh sách, không có trạng thái chờ đồng ý.
            </div>

            {debounced !== '' && searchResults.loading && searchResults.items.length === 0 && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--color-muted)' }}>Đang tìm…</div>
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
                  Không tìm thấy ai khớp “{debounced}”
                </div>
                {/* Bản vẽ gõ sai "hoạc" — sửa thành "hoặc" (§0c, đã duyệt). */}
                <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 4 }}>
                  Thử tên hoặc @username khác.
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
                        title={already ? 'Người này đã ở trong board.' : undefined}
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
                        Mời
                      </button>
                    </div>
                  );
                })}
              </div>
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
              {formatCount(memberCount)} người trong board
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
                    Chủ board
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
                    aria-label={`Vai trò của ${c.user.name ?? c.user.username}`}
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
                    <option value="VIEWER">Người xem</option>
                    <option value="EDITOR">Người sửa</option>
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
                      Gỡ
                    </button>
                  )}
                </div>
              ))}

              {collaborators.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1.6 }}>
                  Board này chưa có cộng tác viên nào.
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
                Rời board
              </button>
            )}
          </div>
        )}
      </div>
    </div>
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
