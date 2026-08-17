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
  CreateSectionDocument,
  UpdateSectionDocument,
  DeleteSectionDocument,
  ReorderSectionsDocument,
  CollaboratorRole,
} from '@/lib/gql/graphql';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { translateBoardError } from '@/lib/errors/board-error-vi';

/**
 * C6 — Quản lý section (FE-10, view=sections). Route `/board/[id]/sections`.
 *
 * ─── Ba chỗ màn này KHÁC bản vẽ, đều có lý do đo được ───
 *
 * 1. **KHÔNG hiện "{n} pin" mỗi hàng.** Bản vẽ có nhãn đó, nhưng SDL
 *    `type BoardSection` chỉ có id/name/sortOrder/boardId/createdAt — KHÔNG có
 *    `pinCount`. Ba đường để có số: bỏ số · đếm bằng N query `boardPins(first:1)`
 *    (tối đa 50 query mỗi lần mở màn, mà vẫn lệch khi pin đổi section ở tab khác)
 *    · thêm field ở backend. Người dùng chốt 17/08: **bỏ số** (tiền lệ FE-8 đã bỏ
 *    số pin ở tab Người dùng). Đừng "sửa lại cho khớp bản vẽ" mà không đọc §4.3.
 *
 * 2. **Đổi tên commit lúc rời ô / Enter, không phải mỗi lần gõ.** Bản vẽ nối
 *    `onChange` → `updateSection`; làm đúng thế là một mutation cho MỖI ký tự.
 *    Ô nhập giữ state cục bộ, chỉ gửi khi giá trị thật sự đổi.
 *
 * 3. **Banner `denied` dùng chuỗi RUNTIME, không phải chuỗi bản vẽ** (§4.4).
 *    Bản vẽ ghi "You do not have permission to edit this board" — nhưng thao tác
 *    section đi qua `checkBoardEditorAccess`, ném "You do not have editor access
 *    to this board". Cả hai khoá đều có trong board-error-vi.ts, cùng trỏ một
 *    chữ Việt; ở đây chặn TRƯỚC bằng vai trò đọc từ board nên người không có
 *    quyền không bấm được gì.
 *
 * 🔴 `reorderSections` nhận TOÀN BỘ mảng id theo thứ tự mới (§4.7) — backend set
 * sortOrder = index trong một transaction. Đừng gửi từng cặp (id, index).
 */

type Section = { id: string; name: string; sortOrder: number };

const MAX_SECTION_NAME = 100;
const MAX_SECTIONS = 50;

type C6State = 'idle' | 'saving' | 'done' | 'toolong' | 'cap' | 'denied' | 'neterr';

export function SectionManageView({ boardId }: { boardId: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { status: sessionStatus } = useSession();

  const boardQuery = useQuery<BoardQuery, BoardQueryVariables>(BoardDocument, {
    variables: { id: boardId },
  });
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: sessionStatus !== 'authenticated' });

  const [createM] = useMutation(CreateSectionDocument);
  const [updateM] = useMutation(UpdateSectionDocument);
  const [deleteM] = useMutation(DeleteSectionDocument);
  const [reorderM] = useMutation(ReorderSectionsDocument);

  const board = boardQuery.data?.board;
  const meId = meQuery.data?.me?.id ?? null;

  /**
   * Quyền sửa = chủ board HOẶC cộng tác viên vai trò EDITOR. VIEWER không sửa
   * được (backend `checkBoardEditorAccess` cùng luật). Chủ board KHÔNG nằm trong
   * mảng `collaborators` — owner là `board.user`.
   */
  const canEdit = useMemo(() => {
    if (!board || !meId) return false;
    if (board.user?.id === meId) return true;
    return (board.collaborators ?? []).some(
      (c) => c.user?.id === meId && c.role === CollaboratorRole.Editor,
    );
  }, [board, meId]);

  // Thứ tự cục bộ để kéo-thả phản hồi tức thì; đồng bộ lại mỗi khi server trả
  // danh sách mới (sau reorder/create/delete refetch).
  const serverSections: Section[] = useMemo(
    () =>
      [...(board?.sections ?? [])]
        .map((s) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [board?.sections],
  );
  const [order, setOrder] = useState<Section[]>(serverSections);
  useEffect(() => {
    setOrder(serverSections);
  }, [serverSections]);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [state, setState] = useState<C6State>('idle');
  const [bannerOverride, setBannerOverride] = useState<string | null>(null);

  const atCap = order.length >= MAX_SECTIONS;

  // Trạng thái hiển thị: `denied` và `cap` suy từ dữ liệu (không phải từ hành
  // động), nên chúng thắng state do hành động đặt.
  const effectiveState: C6State = !canEdit && board ? 'denied' : atCap && state === 'idle' ? 'cap' : state;
  const disabled = effectiveState === 'denied';

  const bannerText = ((): string | null => {
    if (bannerOverride) return bannerOverride;
    switch (effectiveState) {
      case 'saving':
        return 'Đang lưu thứ tự mới…';
      case 'done':
        return 'Đã lưu thứ tự mới.';
      case 'toolong':
        return `Tên section tối đa ${MAX_SECTION_NAME} ký tự.`;
      case 'cap':
        // Chuỗi backend nguyên văn 'Max 50 sections per board' → bảng dịch QĐ-8.
        return translateBoardError('Max 50 sections per board');
      case 'denied':
        return translateBoardError('You do not have editor access to this board');
      case 'neterr':
        return 'Không lưu được thứ tự — mất kết nối.';
      default:
        return null;
    }
  })();
  const bannerTone: 'success' | 'danger' =
    effectiveState === 'saving' || effectiveState === 'done' ? 'success' : 'danger';

  /** Dịch lỗi mutation → banner. Chuỗi lạ giữ nguyên (nhánh dự phòng QĐ-8). */
  function showError(err: unknown, fallback: string) {
    const raw = err instanceof Error ? err.message : '';
    setBannerOverride(translateBoardError(raw) ?? fallback);
    setState('neterr');
  }

  async function onAdd() {
    const name = newName.trim();
    if (!name || disabled) return;
    if (name.length > MAX_SECTION_NAME) {
      setBannerOverride(null);
      setState('toolong');
      return;
    }
    if (atCap) {
      setBannerOverride(null);
      setState('cap');
      return;
    }
    setBannerOverride(null);
    try {
      await createM({ variables: { input: { boardId, name } } });
      setNewName('');
      setState('idle');
      await boardQuery.refetch();
      toast({ message: 'Đã thêm section' });
    } catch (err) {
      showError(err, 'Không thêm được section, thử lại sau.');
    }
  }

  async function onRename(section: Section, nextName: string) {
    const name = nextName.trim();
    if (disabled || !name || name === section.name) return;
    if (name.length > MAX_SECTION_NAME) {
      setBannerOverride(null);
      setState('toolong');
      return;
    }
    setBannerOverride(null);
    try {
      await updateM({ variables: { input: { id: section.id, name } } });
      setState('idle');
      await boardQuery.refetch();
    } catch (err) {
      showError(err, 'Không đổi được tên section, thử lại sau.');
    }
  }

  async function onDelete(section: Section) {
    if (disabled) return;
    const ok = await confirm({
      title: 'Xoá section này?',
      body: 'Pin trong section sẽ trở về board, không bị xoá.',
      yesLabel: 'Xoá section',
      danger: true,
    });
    if (!ok) return;
    setBannerOverride(null);
    try {
      await deleteM({ variables: { id: section.id } });
      setState('idle');
      await boardQuery.refetch();
      // KHÔNG gắn Hoàn tác: không có mutation nào dựng lại section đã xoá cùng
      // các pin đã gán (luật toast — chỉ hành động đảo được mới có Hoàn tác).
      toast({ message: `Đã xoá section "${section.name}"` });
    } catch (err) {
      showError(err, 'Không xoá được section, thử lại sau.');
    }
  }

  /** Thả hàng `from` vào vị trí `to` → gửi CẢ MẢNG id theo thứ tự mới. */
  async function onReorder(from: number, to: number) {
    if (disabled || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const previous = order;
    setOrder(next); // lạc quan — hoàn nguyên nếu server từ chối
    setBannerOverride(null);
    setState('saving');
    try {
      await reorderM({ variables: { boardId, sectionIds: next.map((s) => s.id) } });
      setState('done');
      await boardQuery.refetch();
    } catch (err) {
      setOrder(previous);
      showError(err, 'Không lưu được thứ tự — mất kết nối.');
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

  return (
    <div style={{ padding: '24px 16px 40px' }} data-screen="C6" data-state={effectiveState}>
      <button
        type="button"
        onClick={() => router.push(`/board/${boardId}`)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--color-muted)', fontWeight: 600, padding: 0, marginBottom: 14 }}
      >
        ← Quay lại board
      </button>

      <h1 style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 24, margin: '0 0 4px', color: 'var(--color-foreground)' }}>
        Quản lý section
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--color-muted)', margin: '0 0 18px' }}>
        Kéo để đổi thứ tự — bản desktop. {order.length}/{MAX_SECTIONS} section
      </p>

      <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {bannerText && (
          <div
            role={bannerTone === 'danger' ? 'alert' : 'status'}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: '11px 14px',
              borderRadius: 12,
              background: 'var(--color-surface-muted)',
              color: bannerTone === 'danger' ? 'var(--color-danger)' : 'var(--color-success)',
              border: '1px solid var(--color-border)',
              lineHeight: 1.6,
            }}
          >
            {bannerText}
          </div>
        )}

        {order.length === 0 ? (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 16,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-foreground)' }}>
              Board này chưa có section
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 6, lineHeight: 1.6 }}>
              Section giúp chia pin trong board thành nhóm. Thêm section đầu tiên ở dưới.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {order.map((s, i) => (
              <SectionRow
                key={s.id}
                section={s}
                dragging={dragIndex === i}
                disabled={disabled}
                onDragStart={() => setDragIndex(i)}
                onDragEnd={() => setDragIndex(null)}
                onDropHere={() => {
                  if (dragIndex !== null) void onReorder(dragIndex, i);
                  setDragIndex(null);
                }}
                onRename={(name) => void onRename(s, name)}
                onDelete={() => void onDelete(s)}
              />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onAdd();
            }}
            disabled={disabled}
            placeholder="Tên section mới"
            aria-label="Tên section mới"
            style={{
              flex: 1,
              padding: '11px 14px',
              borderRadius: 12,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              fontSize: 13.5,
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => void onAdd()}
            disabled={disabled || newName.trim() === ''}
            style={{
              padding: '11px 20px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--color-primary)',
              color: 'var(--color-primary-foreground)',
              fontWeight: 700,
              fontSize: 13.5,
              cursor: disabled || newName.trim() === '' ? 'not-allowed' : 'pointer',
              opacity: disabled || newName.trim() === '' ? 0.6 : 1,
              flex: 'none',
            }}
          >
            Thêm section
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionRow({
  section,
  dragging,
  disabled,
  onDragStart,
  onDragEnd,
  onDropHere,
  onRename,
  onDelete,
}: {
  section: Section;
  dragging: boolean;
  disabled: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropHere: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(section.name);
  // Server là nguồn sự thật: khi tên đổi từ ngoài (refetch sau rename/thất bại),
  // ô nhập phải theo. `section.id` trong deps để reset đúng khi danh sách xáo.
  useEffect(() => {
    setDraft(section.name);
  }, [section.id, section.name]);

  return (
    <div
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropHere();
      }}
      onDragEnd={onDragEnd}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '10px 12px',
        borderRadius: 14,
        background: 'var(--color-surface)',
        border: `1px solid ${dragging ? 'var(--color-primary-strong)' : 'var(--color-border)'}`,
        opacity: dragging ? 0.55 : 1,
      }}
    >
      <span
        title="Kéo để đổi thứ tự"
        aria-hidden
        style={{ color: 'var(--color-muted)', cursor: disabled ? 'default' : 'grab', fontSize: 15, lineHeight: 1 }}
      >
        ⠿
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRename(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onRename(draft);
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') setDraft(section.name);
        }}
        disabled={disabled}
        aria-label={`Tên section ${section.name}`}
        style={{
          flex: 1,
          minWidth: 0,
          padding: '9px 12px',
          borderRadius: 10,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface-muted)',
          color: 'var(--color-foreground)',
          fontSize: 13.5,
          outline: 'none',
        }}
      />
      {!disabled && (
        <button
          type="button"
          onClick={onDelete}
          style={{
            padding: '8px 14px',
            borderRadius: 999,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-danger)',
            fontWeight: 600,
            fontSize: 12.5,
            cursor: 'pointer',
            flex: 'none',
          }}
        >
          Xoá
        </button>
      )}
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
