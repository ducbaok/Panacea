'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery } from '@apollo/client/react';
import { BoardDocument, type BoardQuery, MeDocument, type MeQuery } from '@/lib/gql/graphql';
import { useBoardPins } from '@/lib/hooks/usePaginatedQuery';
import { PinGrid } from '@/components/pin/pin-grid';
import { useToast } from '@/components/ui/toast';
import { formatCount } from '@/lib/format';

/**
 * C4 — Chi tiết board (FE-6, view=board).
 *
 * Lọc section chạy ở SERVER: truyền `sectionId` xuống `boardPins`, KHÔNG lọc ở
 * client (lọc client thì phân trang sai từ trang 2 — §6 mục 4). Chip "Tất cả"
 * đặt sectionId=null.
 *
 * Nút Chia sẻ (QĐ-4): copy `/board/<id>` — ẨN HẲN khi board.isSecret (link đó
 * người ngoài không mở được, hiện nút là nói dối). Sửa board / Cộng tác viên /
 * Quản lý section trỏ C5/C7/C6 — NGOÀI phạm vi (§9): giữ nút, vô hiệu hoá.
 * Chữ chép nguyên văn từ Panacea-v2.html.
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
          <>
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
            <DisabledButton title="Cộng tác viên sẽ có ở bản sau">Cộng tác viên</DisabledButton>
            <DisabledButton title="Quản lý section sẽ có ở bản sau">Quản lý section</DisabledButton>
          </>
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

function DisabledButton({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <button
      type="button"
      disabled
      title={title}
      style={{
        padding: '9px 18px',
        borderRadius: 999,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-muted)',
        fontWeight: 600,
        fontSize: 13,
        cursor: 'not-allowed',
        opacity: 0.6,
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
