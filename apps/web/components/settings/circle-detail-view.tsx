'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  AddCircleMembersDocument,
  type AddCircleMembersMutation,
  type AddCircleMembersMutationVariables,
  CircleDocument,
  type CircleQuery,
  type CircleQueryVariables,
  CircleMemberSuggestionsDocument,
  type CircleMemberSuggestionsQuery,
  type CircleMemberSuggestionsQueryVariables,
  DeleteCircleDocument,
  type DeleteCircleMutation,
  type DeleteCircleMutationVariables,
  DuplicateCircleDocument,
  type DuplicateCircleMutation,
  type DuplicateCircleMutationVariables,
  MyCirclesDocument,
  RemoveCircleMemberDocument,
  type RemoveCircleMemberMutation,
  type RemoveCircleMemberMutationVariables,
  SearchUsersDocument,
  type SearchUsersQuery,
  type SearchUsersQueryVariables,
  UpdateCircleDocument,
  type UpdateCircleMutation,
  type UpdateCircleMutationVariables,
} from '@/lib/gql/graphql';
import { circleErrorKey, rawErrorMessage } from '@/lib/errors/circle-error';
import { mapError } from '@/lib/errors/map-error';
import { circleMeta } from '@/lib/visibility';
import { useT } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n/translate';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import {
  backLinkStyle,
  cardStyle,
  inputStyle,
  outlineBtn,
  primaryBtn,
  smallOutlineBtn,
  uppercaseHeading,
} from '@/components/settings/circle-ui';

/**
 * XH-CIRCLES · chi tiết — hai trạng thái còn lại của bản vẽ: `detail` và
 * `emptyMembers` (vòng 0 người).
 *
 * Ngữ nghĩa MỘT CHIỀU phải hiện ra chữ, không chỉ nằm trong code (spec §3):
 * người được thêm KHÔNG được hỏi và KHÔNG nhận thông báo; bớt ai đó là họ mất
 * quyền xem **hồi tố** — kể cả pin cũ — và **im lặng**. Vì thế hộp xác nhận khi
 * bớt người nói thẳng hai điều đó, chép nguyên văn bản vẽ.
 *
 * ⚠️ Vòng của người khác ⇒ backend trả **404**, không phải 403 (cùng chính
 * sách với pin ngoài khán giả: không phân biệt "không có" với "không phải của
 * bạn"). Màn này vì thế gộp hai nhánh vào một thông điệp duy nhất.
 *
 * Ô "Thêm người" dùng `search(type: USER)` — tên `searchUsers` trong bản vẽ là
 * tên nháp, không có trong schema (`ban-do-man-panacea.md` §2b).
 */
export function CircleDetailView({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const { data, loading, error, refetch } = useQuery<CircleQuery, CircleQueryVariables>(
    CircleDocument,
    { variables: { id }, fetchPolicy: 'cache-and-network' },
  );

  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [editing, setEditing] = useState(false);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  const circle = data?.circle ?? null;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const suggestions = useQuery<CircleMemberSuggestionsQuery, CircleMemberSuggestionsQueryVariables>(
    CircleMemberSuggestionsDocument,
    { variables: { circleId: id, first: 10 } },
  );
  const search = useQuery<SearchUsersQuery, SearchUsersQueryVariables>(SearchUsersDocument, {
    variables: { query: debounced, first: 10 },
    skip: debounced.length < 1,
  });

  const refetchLists = {
    refetchQueries: [
      { query: CircleDocument, variables: { id } },
      { query: MyCirclesDocument, variables: { includeAdHoc: false } },
    ],
  };
  const [addMembers] = useMutation<AddCircleMembersMutation, AddCircleMembersMutationVariables>(
    AddCircleMembersDocument,
    refetchLists,
  );
  const [removeMember] = useMutation<
    RemoveCircleMemberMutation,
    RemoveCircleMemberMutationVariables
  >(RemoveCircleMemberDocument, refetchLists);
  const [updateCircle] = useMutation<UpdateCircleMutation, UpdateCircleMutationVariables>(
    UpdateCircleDocument,
    refetchLists,
  );
  const [duplicateCircle] = useMutation<
    DuplicateCircleMutation,
    DuplicateCircleMutationVariables
  >(DuplicateCircleDocument, {
    refetchQueries: [{ query: MyCirclesDocument, variables: { includeAdHoc: false } }],
  });
  const [deleteCircle] = useMutation<DeleteCircleMutation, DeleteCircleMutationVariables>(
    DeleteCircleDocument,
    {
      refetchQueries: [{ query: MyCirclesDocument, variables: { includeAdHoc: false } }],
    },
  );

  const memberIds = useMemo(
    () => new Set((circle?.members ?? []).map((m) => m.id)),
    [circle?.members],
  );

  /** Người đã ở trong vòng thì không hiện lại ở khối thêm — đỡ một cú 400 vô ích. */
  const addable = (
    debounced.length > 0
      ? (search.data?.search.users?.items ?? [])
      : (suggestions.data?.circleMemberSuggestions ?? [])
  ).filter((u) => !memberIds.has(u.id));

  function report(err: unknown) {
    setErrorKey(circleErrorKey(rawErrorMessage(err)) ?? 'errors.circle.maxMembers');
  }

  async function onAdd(user: { id: string; name?: string | null; username?: string | null }) {
    setErrorKey(null);
    try {
      await addMembers({ variables: { input: { circleId: id, userIds: [user.id] } } });
      toast({ message: t('circles.memberAdded', { name: user.name ?? user.username ?? '' }) });
    } catch (err) {
      report(err);
    }
  }

  async function onDrop(user: { id: string; name?: string | null; username?: string | null }) {
    const who = user.name ?? user.username ?? '';
    const ok = await confirm({
      title: t('circles.confirmDropTitle', { name: who }),
      body: t('circles.confirmDropBody'),
      yesLabel: t('circles.confirmDropYes'),
      danger: true,
    });
    if (!ok) return;
    setErrorKey(null);
    try {
      await removeMember({ variables: { circleId: id, userId: user.id } });
      toast({ message: t('circles.memberDropped', { name: who }) });
    } catch (err) {
      report(err);
    }
  }

  async function onSaveName(nextName: string, nextRank: string) {
    if (!circle) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
    const parsed = nextRank.trim() === '' ? null : Number(nextRank);
    setErrorKey(null);
    try {
      await updateCircle({
        variables: {
          input: {
            id,
            name: trimmed,
            rank: parsed != null && Number.isFinite(parsed) ? parsed : null,
          },
        },
      });
      setEditing(false);
      toast({ message: t('circles.updated') });
    } catch (err) {
      report(err);
    }
  }

  async function onDuplicate() {
    if (!circle) return;
    const copyName = t('circles.duplicateNameSuffix', { name: circle.name });
    setErrorKey(null);
    try {
      const res = await duplicateCircle({
        variables: { input: { sourceCircleId: id, name: copyName, rank: circle.rank ?? null } },
      });
      toast({ message: t('circles.duplicated', { name: res.data?.duplicateCircle.name ?? copyName }) });
      const newId = res.data?.duplicateCircle.id;
      if (newId) router.push(`/settings/circles/${newId}`);
    } catch (err) {
      report(err);
    }
  }

  async function onDelete() {
    if (!circle) return;
    const ok = await confirm({
      title: t('circles.confirmDeleteTitle', { name: circle.name }),
      body: t('circles.confirmDeleteBody'),
      yesLabel: t('circles.confirmDeleteYes'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCircle({ variables: { id } });
      toast({ message: t('circles.deleted') });
      router.push('/settings/circles');
    } catch (err) {
      report(err);
    }
  }

  if (loading && !circle) {
    return <CenterNote>{t('common.loading')}</CenterNote>;
  }

  // Vòng của người khác và vòng không tồn tại đều là 404 — cố ý không phân biệt.
  if (error && !circle) {
    const kind = mapError(error).kind;
    return (
      <div style={{ padding: '24px 16px 40px', maxWidth: 640 }}>
        <button type="button" onClick={() => router.push('/settings/circles')} style={backLinkStyle}>
          ← {t('circles.backAll')}
        </button>
        <div style={{ ...cardStyle, padding: '48px 20px', textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {kind === 'network' ? t('circles.loadFailed') : t('circles.notFound')}
          </div>
          {kind === 'network' && (
            <button
              type="button"
              onClick={() => void refetch()}
              style={{ ...outlineBtn, marginTop: 14 }}
            >
              {t('common.retry')}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!circle) return <CenterNote>{t('circles.notFound')}</CenterNote>;

  const members = circle.members;

  return (
    <div
      style={{ padding: '24px 16px 40px' }}
      data-screen="XH-CIRCLES"
      data-state={members.length === 0 ? 'emptyMembers' : 'detail'}
    >
      <button type="button" onClick={() => router.push('/settings/circles')} style={backLinkStyle}>
        ← {t('circles.backAll')}
      </button>

      <div style={{ maxWidth: 640 }}>
        {errorKey && (
          <div role="alert" data-state="error" style={errorBanner}>
            {t(errorKey)}
          </div>
        )}

        <div style={{ ...cardStyle, padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 20 }}>
                {circle.name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 3 }}>
                {circleMeta(t, { memberCount: members.length, rank: circle.rank })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setEditing((v) => !v)} style={smallOutlineBtn}>
                {t('circles.editNameRank')}
              </button>
              <button type="button" onClick={() => void onDuplicate()} style={smallOutlineBtn}>
                {t('circles.duplicate')}
              </button>
              <button
                type="button"
                onClick={() => void onDelete()}
                style={{ ...smallOutlineBtn, color: 'var(--color-danger)' }}
              >
                {t('circles.deleteCircle')}
              </button>
            </div>
          </div>

          {editing && (
            /* `key` = id vòng: đổi vòng thì form MOUNT LẠI với giá trị mới.
               Đó là cách điền sẵn mà không cần một effect setState — effect kiểu
               đó vừa gây render dây chuyền vừa đè mất chữ người dùng đang gõ. */
            <CircleNameForm
              key={circle.id}
              initialName={circle.name}
              initialRank={circle.rank == null ? '' : String(circle.rank)}
              onSave={onSaveName}
            />
          )}

          {members.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
              {members.map((m) => (
                <div
                  key={m.id}
                  data-testid="circle-member"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: 10,
                    borderRadius: 12,
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <Avatar name={m.name ?? m.username} url={m.avatarUrl} size={38} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{m.name ?? m.username}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>@{m.username}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onDrop(m)}
                    style={{ ...smallOutlineBtn, padding: '8px 14px', color: 'var(--color-danger)' }}
                  >
                    {t('circles.drop')}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                marginTop: 18,
                padding: '32px 20px',
                textAlign: 'center',
                borderRadius: 14,
                background: 'var(--color-surface-muted)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{t('circles.noMembersTitle')}</div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--color-muted)',
                  marginTop: 6,
                  lineHeight: 1.6,
                }}
              >
                {t('circles.noMembersBody')}
              </div>
            </div>
          )}

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
              {t('circles.addPeople')}
            </div>
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('circles.searchPlaceholder')}
              data-testid="circle-add-search"
              style={inputStyle}
            />
            <div style={uppercaseHeading}>
              {debounced.length > 0 ? t('circles.searchHeading') : t('circles.suggestHeading')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {addable.map((u) => (
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
                  <Avatar name={u.name ?? u.username} url={u.avatarUrl} size={36} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{u.name ?? u.username}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>@{u.username}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onAdd(u)}
                    data-testid="circle-add"
                    style={{ ...primaryBtn, padding: '8px 16px', fontSize: 12.5 }}
                  >
                    {t('circles.add')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CircleNameForm({
  initialName,
  initialRank,
  onSave,
}: {
  initialName: string;
  initialRank: string;
  onSave: (name: string, rank: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [rank, setRank] = useState(initialRank);
  return (
    <div style={{ display: 'flex', gap: 9, marginTop: 14, flexWrap: 'wrap' }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('circles.namePlaceholder')}
        data-testid="circle-edit-name"
        style={{ ...inputStyle, flex: '2 1 220px', width: 'auto' }}
      />
      <input
        value={rank}
        onChange={(e) => setRank(e.target.value.replace(/[^0-9]/g, ''))}
        inputMode="numeric"
        placeholder={t('circles.rankPlaceholder')}
        style={{ ...inputStyle, flex: '1 1 120px', width: 'auto' }}
      />
      <button type="button" onClick={() => onSave(name, rank)} style={primaryBtn}>
        {t('common.save')}
      </button>
    </div>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '48px 20px',
        textAlign: 'center',
        color: 'var(--color-muted)',
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}

function Avatar({
  name,
  url,
  size,
}: {
  name?: string | null;
  url?: string | null;
  size: number;
}) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
      />
    );
  }
  return (
    <span
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
    </span>
  );
}

const errorBanner: React.CSSProperties = {
  marginBottom: 14,
  padding: '12px 15px',
  borderRadius: 14,
  background: 'var(--color-surface-muted)',
  border: '1px solid var(--color-danger)',
  color: 'var(--color-danger)',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.55,
};
