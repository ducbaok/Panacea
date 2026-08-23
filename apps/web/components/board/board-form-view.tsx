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
import { boardErrorKey } from '@/lib/errors/board-error';
import { useT } from '@/lib/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';

/**
 * C5 — Tạo/sửa board (mockup `view=boardform`, data-screen="C5"). 8 trạng thái ×
 * 2 chế độ. ⚠️ Input ở C5 nền `--color-surface-muted` (KHÁC B4/B5 dùng surface).
 *
 * Lỗi backend cho board GIỮ NGUYÊN tiếng Anh ⇒ quy về key qua boardErrorKey
 * (QĐ-8 §5d — một bảng, một chỗ). cap ("200 board") + denied ("quyền sửa board").
 */

const NAME_MAX = 100;
const DESC_MAX = 500;

export function CreateBoardView() {
  return <BoardForm mode="create" isOwner />;
}

export function EditBoardView({ boardId }: { boardId: string }) {
  const t = useT();
  const { status } = useSession();
  const query = useQuery<BoardQuery, BoardQueryVariables>(BoardDocument, { variables: { id: boardId } });
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: status !== 'authenticated' });
  const state = toReadState({ data: query.data, loading: query.loading, error: query.error });

  if (state.phase === 'loading' || meQuery.loading) {
    return <CenterNote>{t('common.loading')}</CenterNote>;
  }
  if (state.phase === 'error') {
    if (state.state.kind === 'not-found') return <CenterNote>{t('board.notFoundOrDeleted')}</CenterNote>;
    if (state.state.kind === 'network') return <CenterNote>{t('pin.serverUnreachable')}</CenterNote>;
    return <CenterNote>{t('board.loadFailed')}</CenterNote>;
  }
  const board = state.data.board;
  if (!board) return <CenterNote>{t('board.notFoundOrDeleted')}</CenterNote>;

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
  const t = useT();
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
  const deniedBanner = isEdit && !isOwner ? t('errors.board.noEditPermission') : null;

  function validate(): 'empty' | 'toolong' | null {
    // ⚠️ biến này TỪNG tên là `t` — đổi thành `trimmed` để nhường tên `t` cho
    // hàm dịch của component (i18n 23/08/2026).
    const trimmed = name.trim();
    if (trimmed === '') return 'empty';
    if (trimmed.length > NAME_MAX) return 'toolong';
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
        setBanner(t('board.savedBanner'));
        toast({ message: t('board.savedToast') });
      } else {
        const res = await createBoard({ variables: { input: { name: trimmedName, description: desc, isSecret } } });
        const created = res.data?.createBoard;
        if (!created) throw new Error('createBoard trả rỗng');
        toast({ message: t('board.createdToast') });
        router.push(`/board/${created.id}`);
      }
    } catch (e) {
      setPhase('idle');
      const raw = e instanceof Error ? e.message : String(e);
      const key = boardErrorKey(raw); // QĐ-8: cap / denied
      const st = mapError(e);
      if (key) setBanner(t(key));
      else if (st.kind === 'network') setBanner(t('board.netErr'));
      else setBanner(isEdit ? t('board.saveFailedGeneric') : t('board.createFailed'));
    }
  }

  async function onDelete() {
    if (!isOwner || !boardId) return;
    const ok = await confirm({
      title: t('board.deleteTitle'),
      body: t('board.deleteBody'),
      yesLabel: t('board.deleteYes'),
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
      toast({ message: t('board.deletedToast') }); // xoá = KHÔNG Hoàn tác (§1 toast)
      router.push('/');
    } catch {
      toast({ message: t('board.deleteFailed') });
    }
  }

  const shownBanner = deniedBanner ?? banner;

  return (
    <div data-screen="C5" style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px 48px' }}>
      <button type="button" onClick={() => router.back()} style={{ ...outlineBtn, marginBottom: 16 }}>
        ← {t('common.back')}
      </button>
      <h1
        style={{
          fontFamily: 'var(--font-display), var(--font-be-vietnam-pro), sans-serif',
          fontSize: 24,
          margin: '0 0 18px',
          color: 'var(--color-foreground)',
        }}
      >
        {isEdit ? t('board.editTitle') : t('board.createTitle')}
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
          <label style={labelStyle} htmlFor="board-name">{t('board.name')}</label>
          <input
            id="board-name"
            type="text"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder={t('board.namePlaceholder')}
            style={inputStyle}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--color-danger)' }}>
              {nameError === 'empty'
                ? t('board.nameRequired')
                : nameError === 'toolong'
                  ? t('board.nameTooLong')
                  : ''}
            </span>
            <span style={{ fontSize: 12, color: name.length >= NAME_MAX ? 'var(--color-danger)' : 'var(--color-muted)' }}>
              {name.length}/{NAME_MAX}
            </span>
          </div>
        </div>

        <div>
          <label style={labelStyle} htmlFor="board-desc">{t('board.description')}</label>
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
            aria-label={t('board.private')}
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
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-foreground)' }}>{t('board.private')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 2, lineHeight: 1.5 }}>
              {t('board.privateHint')}
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
            {phase === 'saving'
              ? t('common.saving')
              : isEdit
                ? t('board.saveChanges')
                : t('board.createTitle')}
          </button>
          <button type="button" onClick={() => router.back()} style={outlineBtn}>
            {t('common.cancel')}
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
            {t('board.deleteBody')}
          </div>
          <button
            type="button"
            onClick={() => void onDelete()}
            style={{ ...outlineBtn, border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}
          >
            {t('board.deleteYes')}
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
