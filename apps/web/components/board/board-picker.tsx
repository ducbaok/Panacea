'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  MeDocument,
  type MeQuery,
  SavePinDocument,
  type SavePinMutation,
  type SavePinMutationVariables,
} from '@/lib/gql/graphql';
import { useUserBoards } from '@/lib/hooks/usePaginatedQuery';
import { useToast } from '@/components/ui/toast';
import { formatCount } from '@/lib/format';

/**
 * B6 — BoardPicker (mockup `showBoardPicker`, brief FE-7 §3.3).
 *
 * Overlay chọn board, mở qua context `useBoardPicker().openBoardPicker(opts)` —
 * cùng khuôn provider với AuthPrompt/Confirm/Toast. HAI chế độ:
 *   • 'save'   — lưu MỘT pin có sẵn vào board đã chọn ⇒ gọi `savePin({pinId,
 *                boardId})` ngay, toast "Đã lưu vào <board>", đóng. Mở từ pill
 *                "Lưu vào bảng ▾" ở pin-detail (cả modal lẫn trang).
 *   • 'select' — CHỈ chọn board, trả về qua `onSelect(board)` KHÔNG mutation.
 *                Dùng ở ô Board của B4 (pin chưa tạo — Q2 H1: createPin xong mới
 *                savePin). Không nhét savePin vào đây để B4 kiểm soát thứ tự.
 *
 * KHÔNG xử "Lưu nhanh" (nút Lưu trên thẻ/pin-detail) — đó là `savePin(boardId:
 * null)` trực tiếp, không mở picker (Q3). Picker chỉ phục vụ "lưu vào board cụ thể".
 *
 * z-index: token `--z-picker` (=62) — TRÊN modal pin (60), DƯỚI confirm (65).
 * KHÔNG chép 95/110/130 của mockup (bẫy §8.7).
 *
 * Section + note (SavePinInput có) CỐ Ý bỏ ở đợt này (Q3 chốt để lại — mục treo
 * PLAN_FRONTEND §6): bản vẽ không có, và savePin idempotent nên bổ sung sau là
 * một lần gọi đè.
 */

export type BoardLite = { id: string; name: string };

type OpenOptions =
  | { mode: 'save'; pinId: string }
  | { mode: 'select'; selectedBoardId?: string | null; onSelect: (board: BoardLite) => void };

type Ctx = { openBoardPicker: (opts: OpenOptions) => void };
const BoardPickerContext = createContext<Ctx>({ openBoardPicker: () => {} });
export const useBoardPicker = () => useContext(BoardPickerContext);

export function BoardPickerProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<OpenOptions | null>(null);
  const open = opts !== null;

  const openBoardPicker = useCallback((o: OpenOptions) => setOpts(o), []);
  const close = useCallback(() => setOpts(null), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <BoardPickerContext.Provider value={{ openBoardPicker }}>
      {children}
      {/* Overlay chỉ mount khi mở ⇒ useUserBoards không chạy ở mọi trang. */}
      {opts && <BoardPickerOverlay options={opts} onClose={close} />}
    </BoardPickerContext.Provider>
  );
}

function BoardPickerOverlay({
  options,
  onClose,
}: {
  options: OpenOptions;
  onClose: () => void;
}) {
  const router = useRouter();
  const { status } = useSession();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  // userBoards ĐÒI userId (không có "myBoards") — lấy me.id trước (§5.1).
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: status !== 'authenticated' });
  const meId = meQuery.data?.me?.id ?? null;

  const boards = useUserBoards({ userId: meId ?? '', first: 50 }, { skip: !meId });

  const [savePin] = useMutation<SavePinMutation, SavePinMutationVariables>(SavePinDocument);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return boards.items;
    return boards.items.filter((b) => b.name.toLowerCase().includes(q));
  }, [boards.items, query]);

  const loading = meQuery.loading || (boards.loading && boards.items.length === 0);

  async function onPick(board: (typeof boards.items)[number]) {
    if (options.mode === 'select') {
      options.onSelect({ id: board.id, name: board.name });
      onClose();
      return;
    }
    // mode 'save' — lưu pin vào board cụ thể.
    if (savingId) return;
    setSavingId(board.id);
    try {
      await savePin({ variables: { input: { pinId: options.pinId, boardId: board.id } } });
      // savePin trả pin { id isSavedByViewer } ⇒ cache tự cập nhật isSavedByViewer.
      toast({ message: `Đã lưu vào ${board.name}` }); // save: KHÔNG Hoàn tác (§1 toast)
      onClose();
    } catch {
      toast({ message: 'Không lưu được vào board, thử lại sau.' });
      setSavingId(null);
    }
  }

  function goCreateBoard() {
    onClose();
    router.push('/board/new');
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
        zIndex: 'var(--z-picker)' as unknown as number,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Lưu vào board"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--color-surface)',
          borderRadius: 22,
          padding: 22,
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-foreground)', marginBottom: 14 }}>
          Lưu vào board
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm board"
          aria-label="Tìm board"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface-muted)',
            fontSize: 13.5,
            color: 'var(--color-foreground)',
            marginBottom: 12,
            boxSizing: 'border-box',
          }}
        />

        <div
          style={{
            maxHeight: 280,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {loading ? (
            <PickerNote>Đang tải danh sách board…</PickerNote>
          ) : boards.error ? (
            <PickerNote>Không tải được danh sách board. Đóng rồi mở lại để thử.</PickerNote>
          ) : boards.items.length === 0 ? (
            <PickerNote>Bạn chưa có board nào — tạo board đầu tiên bên dưới.</PickerNote>
          ) : filtered.length === 0 ? (
            <PickerNote>Không có board nào khớp “{query.trim()}”.</PickerNote>
          ) : (
            filtered.map((b) => {
              const selected = options.mode === 'select' && options.selectedBoardId === b.id;
              const thumb = b.coverPin?.thumbnailUrl ?? b.coverPin?.imageUrl ?? null;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onPick(b)}
                  disabled={savingId !== null}
                  aria-pressed={selected}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    padding: 8,
                    borderRadius: 12,
                    border: 'none',
                    background: selected ? 'var(--color-primary-soft)' : 'transparent',
                    cursor: savingId !== null ? 'default' : 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      aria-hidden
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: 'var(--color-surface-muted)',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: 'var(--color-foreground)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {b.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                      {savingId === b.id ? 'Đang lưu…' : `${formatCount(b.pinCount)} pin`}
                    </div>
                  </div>
                </button>
              );
            })
          )}

          {!loading && !boards.error && boards.hasNextPage && (
            <button
              type="button"
              onClick={() => void boards.loadMore()}
              disabled={boards.loadingMore}
              style={{
                border: 'none',
                background: 'none',
                color: 'var(--color-primary-strong)',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px 8px',
                textAlign: 'left',
              }}
            >
              {boards.loadingMore ? 'Đang tải…' : 'Tải thêm board'}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={goCreateBoard}
          style={{
            width: '100%',
            marginTop: 12,
            padding: '11px 14px',
            borderRadius: 12,
            border: '1px dashed var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-foreground)',
            fontWeight: 600,
            fontSize: 13.5,
            cursor: 'pointer',
          }}
        >
          + Tạo board mới
        </button>
      </div>
    </div>
  );
}

function PickerNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '18px 12px',
        textAlign: 'center',
        color: 'var(--color-muted)',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}
