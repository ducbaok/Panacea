'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  BoardDocument,
  type BoardQuery,
  type BoardQueryVariables,
  MeDocument,
  type MeQuery,
  CreateBoardDocument,
  type CreateBoardMutation,
  type CreateBoardMutationVariables,
  UpdateBoardDocument,
  type UpdateBoardMutation,
  type UpdateBoardMutationVariables,
  DeleteBoardDocument,
  type DeleteBoardMutation,
  type DeleteBoardMutationVariables,
} from '@/lib/gql/graphql';
import { toReadState, mapError } from '@/lib/errors/map-error';
import { translateBoardError } from '@/lib/errors/board-error-vi';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';

/**
 * C5 — Tạo/sửa board (mockup `view=boardform`, data-screen="C5"). 8 trạng thái ×
 * 2 chế độ. ⚠️ Input ở C5 nền `--color-surface-muted` (KHÁC B4/B5 dùng surface).
 *
 * Lỗi backend cho board GIỮ NGUYÊN tiếng Anh ⇒ dịch qua translateBoardError
 * (QĐ-8 §5d — một bảng, một chỗ). cap ("200 board") + denied ("quyền sửa board").
 */

const NAME_MAX = 100;
const DESC_MAX = 500;

export function CreateBoardView() {
  return <BoardForm mode="create" isOwner />;
}

export function EditBoardView({ boardId }: { boardId: string }) {
  const { status } = useSession();
  const query = useQuery<BoardQuery, BoardQueryVariables>(BoardDocument, { variables: { id: boardId } });
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: status !== 'authenticated' });
  const state = toReadState({ data: query.data, loading: query.loading, error: query.error });

  if (state.phase === 'loading' || meQuery.loading) {
    return <CenterNote>Đang tải…</CenterNote>;
  }
  if (state.phase === 'error') {
    if (state.state.kind === 'not-found') return <CenterNote>Board không tồn tại hoặc đã bị xoá.</CenterNote>;
    if (state.state.kind === 'network') return <CenterNote>Không kết nối được máy chủ.</CenterNote>;
    return <CenterNote>Không tải được board.</CenterNote>;
  }
  const board = state.data.board;
  if (!board) return <CenterNote>Board không tồn tại hoặc đã bị xoá.</CenterNote>;

  const meId = meQuery.data?.me?.id ?? null;
  const isOwner = meId != null && board.user?.id === meId;

  return (
    <BoardForm
      mode="edit"
      boardId={board.id}
      isOwner={isOwner}
      initial={{
        name: board.name ?? '',
        description: board.description ?? '',
        isSecret: !!board.isSecret,
      }}
    />
  );
}

type BoardFormProps = {
  mode: 'create' | 'edit';
  boardId?: string;
  isOwner: boolean;
  initial?: { name: string; description: string; isSecret: boolean };
};

function BoardForm({ mode, boardId, isOwner, initial }: BoardFormProps) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isSecret, setIsSecret] = useState(initial?.isSecret ?? false);
  const [nameError, setNameError] = useState<'empty' | 'toolong' | null>(null);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'done'>('idle');
  const [banner, setBanner] = useState<string | null>(null);

  const [createBoard] = useMutation<CreateBoardMutation, CreateBoardMutationVariables>(CreateBoardDocument);
  const [updateBoard] = useMutation<UpdateBoardMutation, UpdateBoardMutationVariables>(UpdateBoardDocument);
  const [deleteBoard] = useMutation<DeleteBoardMutation, DeleteBoardMutationVariables>(DeleteBoardDocument);

  const isEdit = mode === 'edit';
  const disabled = !isOwner || phase === 'saving';

  // Chế độ sửa nhưng không phải chủ ⇒ denied (server là nguồn sự thật cuối).
  const deniedBanner = isEdit && !isOwner ? 'Bạn không có quyền sửa board này.' : null;

  function validate(): 'empty' | 'toolong' | null {
    const t = name.trim();
    if (t === '') return 'empty';
    if (t.length > NAME_MAX) return 'toolong';
    return null;
  }

  async function onSubmit() {
    if (disabled) return;
    const err = validate();
    setNameError(err);
    if (err) return;

    setPhase('saving');
    setBanner(null);
    const trimmedName = name.trim();
    const desc = description.trim() || null;
    try {
      if (isEdit && boardId) {
        await updateBoard({ variables: { input: { id: boardId, name: trimmedName, description: desc, isSecret } } });
        setPhase('done');
        setBanner('Đã lưu board.');
        toast({ message: 'Đã lưu board' });
      } else {
        const res = await createBoard({ variables: { input: { name: trimmedName, description: desc, isSecret } } });
        const created = res.data?.createBoard;
        if (!created) throw new Error('createBoard trả rỗng');
        toast({ message: 'Đã tạo board' });
        router.push(`/board/${created.id}`);
      }
    } catch (e) {
      setPhase('idle');
      const raw = e instanceof Error ? e.message : String(e);
      const translated = translateBoardError(raw); // QĐ-8: cap / denied
      const st = mapError(e);
      if (translated) setBanner(translated);
      else if (st.kind === 'network') setBanner('Không lưu được — mất kết nối. Dữ liệu bạn nhập vẫn còn ở đây.');
      else setBanner(isEdit ? 'Không lưu được board, thử lại sau.' : 'Không tạo được board, thử lại sau.');
    }
  }

  async function onDelete() {
    if (!isOwner || !boardId) return;
    const ok = await confirm({
      title: 'Xoá board này?',
      body: 'Các pin đã lưu sẽ bỏ khỏi board, pin gốc của người tạo vẫn còn.',
      yesLabel: 'Xoá board',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteBoard({
        variables: { id: boardId },
        update: (cache) => {
          cache.evict({ id: cache.identify({ __typename: 'Board', id: boardId }) });
          cache.gc();
        },
      });
      toast({ message: 'Đã xoá board' }); // xoá = KHÔNG Hoàn tác (§1 toast)
      router.push('/');
    } catch {
      toast({ message: 'Không xoá được board, thử lại sau.' });
    }
  }

  const shownBanner = deniedBanner ?? banner;

  return (
    <div data-screen="C5" style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px 48px' }}>
      <button type="button" onClick={() => router.back()} style={{ ...outlineBtn, marginBottom: 16 }}>
        ← Quay lại
      </button>
      <h1
        style={{
          fontFamily: 'var(--font-display), var(--font-be-vietnam-pro), sans-serif',
          fontSize: 24,
          margin: '0 0 18px',
          color: 'var(--color-foreground)',
        }}
      >
        {isEdit ? 'Sửa board' : 'Tạo board'}
      </h1>

      {shownBanner && (
        <div
          role={phase === 'done' ? 'status' : 'alert'}
          style={{
            fontSize: 12.5,
            padding: '11px 14px',
            borderRadius: 12,
            background: 'var(--color-surface-muted)',
            border: '1px solid var(--color-border)',
            color: phase === 'done' ? 'var(--color-success)' : 'var(--color-danger)',
            marginBottom: 16,
          }}
        >
          {shownBanner}
        </div>
      )}

      <fieldset
        disabled={disabled}
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 18,
          padding: 22,
          margin: 0,
          background: 'var(--color-surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          opacity: deniedBanner ? 0.6 : 1,
        }}
      >
        <div>
          <label style={labelStyle} htmlFor="board-name">Tên board</label>
          <input
            id="board-name"
            type="text"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder="Ví dụ: Bữa tối nhanh"
            style={inputStyle}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--color-danger)' }}>
              {nameError === 'empty'
                ? 'Tên board không được để trống.'
                : nameError === 'toolong'
                  ? 'Tên board tối đa 100 ký tự.'
                  : ''}
            </span>
            <span style={{ fontSize: 12, color: name.length >= NAME_MAX ? 'var(--color-danger)' : 'var(--color-muted)' }}>
              {name.length}/{NAME_MAX}
            </span>
          </div>
        </div>

        <div>
          <label style={labelStyle} htmlFor="board-desc">Mô tả</label>
          <textarea
            id="board-desc"
            value={description}
            maxLength={DESC_MAX}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div style={{ fontSize: 12, color: description.length >= DESC_MAX ? 'var(--color-danger)' : 'var(--color-muted)', textAlign: 'right', marginTop: 4 }}>
            {description.length}/{DESC_MAX}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button
            type="button"
            role="switch"
            aria-checked={isSecret}
            aria-label="Board riêng tư"
            onClick={() => setIsSecret((v) => !v)}
            style={{
              width: 46,
              height: 27,
              borderRadius: 999,
              border: 'none',
              background: isSecret ? 'var(--color-primary)' : 'var(--color-border)',
              position: 'relative',
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                position: 'absolute',
                top: 3,
                left: isSecret ? 22 : 3,
                width: 21,
                height: 21,
                borderRadius: '50%',
                background: '#ffffff',
                transition: 'left var(--duration-hover, 120ms)',
              }}
            />
          </button>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-foreground)' }}>Board riêng tư</div>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 2, lineHeight: 1.5 }}>
              Chỉ bạn và cộng tác viên thấy board này.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled}
            style={{
              ...primaryBtn,
              background: phase === 'saving' ? 'var(--color-primary-soft)' : 'var(--color-primary)',
              color: phase === 'saving' ? 'var(--color-muted)' : 'var(--color-primary-foreground)',
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {phase === 'saving' ? 'Đang lưu…' : isEdit ? 'Lưu thay đổi' : 'Tạo board'}
          </button>
          <button type="button" onClick={() => router.back()} style={outlineBtn}>
            Huỷ
          </button>
        </div>
      </fieldset>

      {/* Card Xoá board — CHỈ ở chế độ sửa (§3.4) */}
      {isEdit && isOwner && (
        <div
          style={{
            marginTop: 18,
            border: '1px solid var(--color-border)',
            borderRadius: 18,
            padding: 22,
            background: 'var(--color-surface)',
          }}
        >
          <div style={{ fontSize: 13.5, color: 'var(--color-muted)', lineHeight: 1.6, marginBottom: 12 }}>
            Các pin đã lưu sẽ bỏ khỏi board, pin gốc của người tạo vẫn còn.
          </div>
          <button
            type="button"
            onClick={() => void onDelete()}
            style={{ ...outlineBtn, border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}
          >
            Xoá board
          </button>
        </div>
      )}
    </div>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200, color: 'var(--color-muted)', fontSize: 13.5 }}>
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-muted)',
  marginBottom: 6,
  display: 'block',
};
// ⚠️ C5 input nền --color-surface-muted (khác B4/B5).
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-muted)',
  fontSize: 14,
  color: 'var(--color-foreground)',
  boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = {
  padding: '11px 20px',
  borderRadius: 999,
  border: 'none',
  background: 'var(--color-primary)',
  color: 'var(--color-primary-foreground)',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
};
const outlineBtn: React.CSSProperties = {
  padding: '11px 20px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-foreground)',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
