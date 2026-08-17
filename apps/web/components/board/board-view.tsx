'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  BoardDocument,
  type BoardQuery,
  MeDocument,
  type MeQuery,
  SetBoardCoverDocument,
  CollaboratorRole,
} from '@/lib/gql/graphql';
import { useBoardPins } from '@/lib/hooks/usePaginatedQuery';
import { PinGrid } from '@/components/pin/pin-grid';
import { useToast } from '@/components/ui/toast';
import { formatCount } from '@/lib/format';
import { translateBoardError } from '@/lib/errors/board-error-vi';

/**
 * C4 — Chi tiết board (FE-6, view=board).
 *
 * Lọc section chạy ở SERVER: truyền `sectionId` xuống `boardPins`, KHÔNG lọc ở
 * client (lọc client thì phân trang sai từ trang 2 — §6 mục 4). Chip "Tất cả"
 * đặt sectionId=null.
 *
 * Nút Chia sẻ (QĐ-4): copy `/board/<id>` — ẨN HẲN khi board.isSecret (link đó
 * người ngoài không mở được, hiện nút là nói dối).
 * Chữ chép nguyên văn từ Panacea-v2.html.
 *
 * FE-10 mở khoá hai nút từng `disabled`: "Cộng tác viên" → C7
 * (`/board/<id>/collaborators`), "Quản lý section" → C6 (`/board/<id>/sections`).
 *
 * FE-10 cũng gráft **setBoardCover** vào từng pin (bản vẽ C4 của
 * `Panacea-v2.1.html` — bản v2 KHÔNG vẽ, nên kết luận "không vẽ cover" của FE-7
 * chỉ đúng cho v2): menu ⋯ "Đặt làm bìa" + badge "Ảnh bìa".
 *   • Badge đọc `board.coverPinId` (server), KHÔNG phải state cục bộ như mockup
 *     — sau F5 badge vẫn đúng và không có hai nguồn sự thật.
 *   • Menu chỉ hiện khi viewer là chủ board HOẶC cộng tác viên EDITOR — trùng
 *     đúng luật `checkBoardEditorAccess` của backend.
 *   • Ẩn/hiện bằng `opacity`, KHÔNG `visibility:hidden`: bài học FE-9 (bấm phát
 *     đầu bị xuyên qua, và máy cảm ứng không có hover ⇒ nút không chạm tới được).
 */
export function BoardView({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { status } = useSession();
  const boardQuery = useQuery<BoardQuery>(BoardDocument, { variables: { id } });
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: status !== 'authenticated' });

  const [sectionId, setSectionId] = useState<string | null>(null);
  const boardPins = useBoardPins(
    useMemo(() => (sectionId ? { boardId: id, sectionId } : { boardId: id }), [id, sectionId]),
  );

  // setBoardCover (FE-10): menu ⋯ mở theo pinId, đóng khi bấm ra ngoài / ESC.
  const [coverMenuPinId, setCoverMenuPinId] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [setCoverM] = useMutation(SetBoardCoverDocument);
  const coverMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!coverMenuPinId) return;
    const onDown = (e: MouseEvent) => {
      if (coverMenuRef.current && !coverMenuRef.current.contains(e.target as Node)) {
        setCoverMenuPinId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCoverMenuPinId(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [coverMenuPinId]);

  if (boardQuery.loading) {
    return <Centered>Đang tải board…</Centered>;
  }

  const board = boardQuery.data?.board;
  if (boardQuery.error || !board) {
    return (
      <Centered>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Không tìm thấy board</div>
        <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>
          Board có thể đã bị xoá, hoặc bạn không có quyền xem.
        </div>
      </Centered>
    );
  }

  const isOwner = status === 'authenticated' && meQuery.data?.me?.id === board.user?.id;
  const isSecret = !!board.isSecret;
  const sections = board.sections ?? [];

  /**
   * Ba mức quyền, KHÁC nhau — đừng gộp:
   *   • isOwner      → sửa board (updateBoard là chủ board ONLY).
   *   • canEditBoard → chủ HOẶC cộng tác viên EDITOR: section + ảnh bìa
   *                    (cùng luật `checkBoardEditorAccess` của backend).
   *   • isCollaborator (mọi vai trò, kể cả VIEWER) → vào được màn C7, vì đó là
   *                    đường DUY NHẤT để tự rời board.
   */
  const meId = meQuery.data?.me?.id ?? null;
  const myCollab = meId
    ? (board.collaborators ?? []).find((c) => c.user?.id === meId)
    : undefined;
  const isCollaborator = !!myCollab;
  const canEditBoard = isOwner || myCollab?.role === CollaboratorRole.Editor;

  const share = async () => {
    const url = `${window.location.origin}/board/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ message: 'Đã copy liên kết' });
    } catch {
      toast({ message: url });
    }
  };

  // `SavedPin.pin` nullable ở SDL ⇒ lọc null trước khi vào PinGrid (PinCardItem
  // non-null). Thực tế backend luôn điền, nhưng type-an-toàn vẫn phải lọc.
  const pinItems = boardPins.items
    .map((sp) => sp.pin)
    .filter((p): p is NonNullable<typeof p> => p != null);

  /**
   * Đặt pin làm ảnh bìa board. Nhánh lỗi "Pin must be saved in this board to be a
   * cover" gần như không chạm được từ đây (menu chỉ đặt trên pin ĐANG ở trong
   * board) nhưng vẫn map — pin có thể bị bỏ lưu ở tab khác giữa hai lần render.
   */
  const onSetCover = async (pinId: string) => {
    setCoverMenuPinId(null);
    if (coverBusy) return;
    setCoverBusy(true);
    try {
      await setCoverM({ variables: { boardId: board.id, pinId } });
      // Đọc lại board để `coverPinId` (nguồn của badge) khớp server.
      await boardQuery.refetch();
      toast({ message: 'Đã đặt làm ảnh bìa board' });
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      toast({ message: translateBoardError(raw) ?? 'Không đặt được ảnh bìa, thử lại sau.' });
    } finally {
      setCoverBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '24px 16px 0' }} data-screen="C4">
      <button
        type="button"
        onClick={() => (board.user?.username ? router.push(`/@${board.user.username}`) : router.back())}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--color-muted)', fontWeight: 600, padding: 0, marginBottom: 14 }}
      >
        ← Tất cả board
      </button>

      <h1 style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 27, margin: '0 0 6px', color: 'var(--color-foreground)' }}>
        {board.name}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: '0 0 14px' }}>
        {board.description ? `${board.description} · ` : ''}
        {formatCount(board.pinCount ?? 0)} pin
      </p>

      <div style={{ display: 'flex', gap: 9, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {isOwner && (
          <button
            type="button"
            onClick={() => router.push(`/board/${board.id}/edit`)}
            style={{
              padding: '9px 18px',
              borderRadius: 999,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Sửa board
          </button>
        )}
        {/* Cộng tác viên: chủ board VÀ cộng tác viên (mọi vai trò) — C7 là đường
            duy nhất để tự rời board, khoá theo isOwner là bẫy người ta ở lại. */}
        {(isOwner || isCollaborator) && (
          <OutlineButton onClick={() => router.push(`/board/${board.id}/collaborators`)}>
            Cộng tác viên
          </OutlineButton>
        )}
        {/* Quản lý section: cần quyền EDITOR — VIEWER mở ra chỉ thấy `denied`. */}
        {canEditBoard && (
          <OutlineButton onClick={() => router.push(`/board/${board.id}/sections`)}>
            Quản lý section
          </OutlineButton>
        )}
        {!isSecret && (
          <button
            type="button"
            onClick={share}
            style={{
              padding: '9px 18px',
              borderRadius: 999,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Chia sẻ
          </button>
        )}
      </div>

      {isSecret && (
        <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14, lineHeight: 1.6 }}>
          Board riêng tư — nút Chia sẻ ẩn hẳn vì người ngoài mở link không được.
        </div>
      )}

      {/* Dải chip section — cuộn ngang, lọc ở SERVER qua sectionId */}
      {sections.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
          <SectionChip label="Tất cả" active={sectionId === null} onClick={() => setSectionId(null)} />
          {sections.map((s) => (
            <SectionChip key={s.id} label={s.name ?? ''} active={sectionId === s.id} onClick={() => setSectionId(s.id)} />
          ))}
        </div>
      )}

      {pinItems.length === 0 && !boardPins.loading ? (
        <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--color-muted)', fontSize: 14 }}>
          {sectionId ? 'Section này chưa có pin nào.' : 'Board này chưa có pin nào.'}
        </div>
      ) : (
        <PinGrid
          items={pinItems}
          loading={boardPins.loading}
          loadingMore={boardPins.loadingMore}
          hasNextPage={boardPins.hasNextPage}
          loadMore={boardPins.loadMore}
          onOpen={(pid) => router.push(`/pin/${pid}`)}
          renderOverlay={(item) => (
            <CoverOverlay
              pinId={item.id}
              isCover={board.coverPinId === item.id}
              canEdit={canEditBoard}
              menuOpen={coverMenuPinId === item.id}
              busy={coverBusy}
              /* Chỉ báo cảm xúc của PinCard cũng nằm góc trái-dưới ⇒ đẩy nút ⋯
                 sang phải khi pin có cảm xúc, để hai thứ không đè nhau. */
              shiftForReaction={!!item.viewerReaction}
              onToggleMenu={() => setCoverMenuPinId((cur) => (cur === item.id ? null : item.id))}
              onSetCover={() => void onSetCover(item.id)}
              menuRef={coverMenuRef}
            />
          )}
        />
      )}
    </div>
  );
}

function SectionChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 'none',
        padding: '8px 14px',
        borderRadius: 999,
        border: active ? '1px solid var(--color-primary-strong)' : '1px solid var(--color-border)',
        background: active ? 'var(--color-primary-soft)' : 'var(--color-surface)',
        color: active ? 'var(--color-primary-strong)' : 'var(--color-foreground)',
        fontWeight: 600,
        fontSize: 13,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/**
 * Overlay ngữ cảnh board trên một pin (bản vẽ C4 của Panacea-v2.1):
 *   • badge "Ảnh bìa" — pill nền primary, góc TRÁI-TRÊN, chỉ trên pin đang là bìa.
 *   • nút ⋯ tròn 32×32 góc TRÁI-DƯỚI → popover 170px với "Đặt làm bìa" + "Đóng".
 *
 * 🔴 Ẩn nút ⋯ bằng `opacity`, KHÔNG `visibility:hidden` (bài học FE-9,
 * LEARNING_NOTES §25-29): với visibility:hidden thì cú bấm đầu tiên xuyên qua, và
 * trên máy cảm ứng — nơi không có hover — nút vĩnh viễn không chạm tới được. Ở
 * đây nút luôn ở trong luồng bấm/chạm/tab, chỉ mờ đi khi chưa rê chuột.
 *
 * `stopPropagation` ở mọi handler: thẻ pin bọc ngoài có onClick mở chi tiết pin.
 */
function CoverOverlay({
  pinId,
  isCover,
  canEdit,
  menuOpen,
  busy,
  shiftForReaction,
  onToggleMenu,
  onSetCover,
  menuRef,
}: {
  pinId: string;
  isCover: boolean;
  canEdit: boolean;
  menuOpen: boolean;
  busy: boolean;
  shiftForReaction: boolean;
  onToggleMenu: () => void;
  onSetCover: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      {isCover && (
        <div
          style={{
            position: 'absolute',
            top: 9,
            left: 9,
            padding: '4px 10px',
            borderRadius: 999,
            background: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
            fontSize: 11.5,
            fontWeight: 700,
          }}
        >
          Ảnh bìa
        </div>
      )}

      {canEdit && (
        <div
          ref={menuOpen ? menuRef : undefined}
          style={{ position: 'absolute', bottom: 9, left: shiftForReaction ? 61 : 9 }}
        >
          <button
            type="button"
            aria-label="Tuỳ chọn pin"
            title="Tuỳ chọn pin"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu();
            }}
            className="transition-opacity"
            style={{
              width: 32,
              height: 32,
              padding: 0,
              border: 'none',
              borderRadius: '50%',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 18,
              lineHeight: 1,
              boxShadow: 'var(--shadow-card)',
              opacity: menuOpen ? 1 : 0.35,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = menuOpen ? '1' : '0.35';
            }}
          >
            ⋯
          </button>

          {menuOpen && (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: 38,
                left: 0,
                width: 170,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 14,
                boxShadow: 'var(--shadow-modal)',
                padding: 6,
                display: 'flex',
                flexDirection: 'column',
                zIndex: 'var(--z-dropdown)' as unknown as number,
              }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={busy || isCover}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetCover();
                }}
                style={{
                  textAlign: 'left',
                  padding: '9px 12px',
                  border: 'none',
                  background: 'none',
                  color: 'var(--color-foreground)',
                  cursor: busy || isCover ? 'not-allowed' : 'pointer',
                  opacity: busy || isCover ? 0.5 : 1,
                  fontSize: 13.5,
                  fontWeight: 600,
                  borderRadius: 8,
                  width: '100%',
                }}
              >
                Đặt làm bìa
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMenu();
                }}
                style={{
                  textAlign: 'left',
                  padding: '9px 12px',
                  border: 'none',
                  background: 'none',
                  color: 'var(--color-muted)',
                  cursor: 'pointer',
                  fontSize: 13.5,
                  fontWeight: 600,
                  borderRadius: 8,
                  width: '100%',
                }}
                data-pin-id={pinId}
              >
                Đóng
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Nút viền cùng khuôn với "Sửa board". FE-10 thay `DisabledButton` (nút chết chờ
 * C6/C7) bằng nút thật — hai màn đó nay đã có.
 */
function OutlineButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '9px 18px',
        borderRadius: 999,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-foreground)',
        fontWeight: 600,
        fontSize: 13,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: '0 16px' }}>
      <div style={{ padding: '48px 20px', textAlign: 'center', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20 }}>
        {children}
      </div>
    </div>
  );
}
