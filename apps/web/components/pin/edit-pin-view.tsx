'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  PinDocument,
  type PinQuery,
  type PinQueryVariables,
  MeDocument,
  type MeQuery,
  UpdatePinDocument,
  type UpdatePinMutation,
  type UpdatePinMutationVariables,
  DeletePinDocument,
  type DeletePinMutation,
  type DeletePinMutationVariables,
  CategoriesDocument,
  type CategoriesQuery,
  TagsDocument,
  type TagsQuery,
  type TagsQueryVariables,
} from '@/lib/gql/graphql';
import { toReadState, mapError } from '@/lib/errors/map-error';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';

/**
 * B5 — Sửa pin (mockup `view=editpin`, data-screen="B5"). 7 trạng thái:
 *   idle · invalid · saving · done · denied · notfound · neterr.
 *
 * 🔴🔴 §4.2 — CẠM BẪY CHÍNH: `updatePin` coi `tagNames`/`categoryIds` là BA
 * trạng thái: undefined = không đụng · [] = XOÁ SẠCH · [a,b] = thay toàn bộ.
 * ⇒ CHỈ gửi hai field này khi người dùng THẬT SỰ đổi chip (so với giá trị pin
 * đọc lúc vào). Serialize "hồn nhiên" (gửi mọi field) sẽ âm thầm xoá tag. Phép
 * T2.3 canh đúng chỗ này.
 *
 * Ảnh KHÔNG đổi được sau khi tạo (mockup subtitle) — cột trái chỉ hiển thị.
 * Guard quyền: pin không phải của mình ⇒ trạng thái `denied` (client đọc
 * creator.id vs me.id để hiện sớm; server vẫn là nguồn sự thật cuối).
 */

const TITLE_MAX = 200;
const DESC_MAX = 2000;
const TAGS_MAX = 10;
const CATS_MAX = 3;

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** So sánh 2 tập chuỗi không kể thứ tự. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

export function EditPinView({ pinId }: { pinId: string }) {
  const router = useRouter();
  const { status } = useSession();
  const query = useQuery<PinQuery, PinQueryVariables>(PinDocument, { variables: { id: pinId } });
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: status !== 'authenticated' });

  const state = toReadState({ data: query.data, loading: query.loading, error: query.error });

  if (state.phase === 'loading' || meQuery.loading) {
    return <CenterNote>Đang tải…</CenterNote>;
  }

  if (state.phase === 'error') {
    if (state.state.kind === 'not-found') {
      return <BannerScreen kind="notfound" onBack={() => router.push('/')} />;
    }
    if (state.state.kind === 'network') {
      return <BannerScreen kind="neterr" onRetry={() => void query.refetch()} />;
    }
    return <CenterNote>Không tải được pin.</CenterNote>;
  }

  const pin = state.data.pin;
  if (!pin) {
    return <BannerScreen kind="notfound" onBack={() => router.push('/')} />;
  }

  const meId = meQuery.data?.me?.id ?? null;
  const isOwner = meId != null && pin.creator.id === meId;

  return <EditPinForm pin={pin} isOwner={isOwner} />;
}

type BannerKind = 'done' | 'denied' | 'notfound' | 'neterr';
const BANNER_TEXT: Record<BannerKind, string> = {
  done: 'Đã lưu thay đổi.',
  denied: 'Bạn không có quyền sửa pin này.',
  notfound: 'Pin không tồn tại hoặc đã bị xoá.',
  neterr: 'Không lưu được — mất kết nối. Dữ liệu bạn nhập vẫn còn ở đây.',
};

function EditPinForm({ pin, isOwner }: { pin: NonNullable<PinQuery['pin']>; isOwner: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  // Giá trị khởi đầu đọc từ pin — mốc để phát hiện đổi chip (§4.2).
  const initialTags = useMemo(() => pin.tags.map((t) => t.name), [pin.tags]);
  const initialCatIds = useMemo(() => pin.categories.map((c) => c.id), [pin.categories]);

  const [title, setTitle] = useState(pin.title ?? '');
  const [description, setDescription] = useState(pin.description ?? '');
  const [sourceUrl, setSourceUrl] = useState(pin.sourceUrl ?? '');
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>(initialCatIds);

  const [phase, setPhase] = useState<'idle' | 'saving' | 'done' | 'neterr'>('idle');

  const catsQuery = useQuery<CategoriesQuery>(CategoriesDocument);
  const [tagQuery, setTagQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setTagQuery(tagInput.trim()), 200);
    return () => clearTimeout(id);
  }, [tagInput]);
  const tagsSug = useQuery<TagsQuery, TagsQueryVariables>(TagsDocument, {
    variables: { query: tagQuery, first: 6 },
    skip: tagQuery.length < 1,
  });

  const [updatePin] = useMutation<UpdatePinMutation, UpdatePinMutationVariables>(UpdatePinDocument);
  const [deletePin] = useMutation<DeletePinMutation, DeletePinMutationVariables>(DeletePinDocument);

  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (doneTimer.current) clearTimeout(doneTimer.current); }, []);

  const sourceUrlValid = sourceUrl.trim() === '' || isValidHttpUrl(sourceUrl.trim());
  const disabled = !isOwner || phase === 'saving';

  const tagSuggestions = useMemo(() => {
    const existing = new Set(tags.map((t) => t.toLowerCase()));
    return (tagsSug.data?.tags ?? []).filter((t) => !existing.has(t.name.toLowerCase())).slice(0, 6);
  }, [tagsSug.data, tags]);

  function addTag(raw: string) {
    const t = raw.trim();
    if (!t || tags.length >= TAGS_MAX) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setTagInput('');
      return;
    }
    setTags([...tags, t]);
    setTagInput('');
  }

  function toggleCategory(id: string) {
    if (categoryIds.includes(id)) setCategoryIds(categoryIds.filter((c) => c !== id));
    else if (categoryIds.length < CATS_MAX) setCategoryIds([...categoryIds, id]);
  }

  async function onSave() {
    if (disabled || !sourceUrlValid) return;
    setPhase('saving');

    // §4.2 — chỉ gửi tagNames/categoryIds khi THẬT SỰ đổi (so tập, không kể thứ tự).
    const tagsChanged = !sameSet(
      tags.map((t) => t.toLowerCase()),
      initialTags.map((t) => t.toLowerCase()),
    );
    const catsChanged = !sameSet(categoryIds, initialCatIds);

    try {
      await updatePin({
        variables: {
          input: {
            id: pin.id,
            title: title.trim() || null,
            description: description.trim() || null,
            sourceUrl: sourceUrl.trim() || null,
            ...(tagsChanged ? { tagNames: tags } : {}),
            ...(catsChanged ? { categoryIds } : {}),
          },
        },
      });
      setPhase('done');
      doneTimer.current = setTimeout(() => setPhase('idle'), 2000);
    } catch (err) {
      const st = mapError(err);
      setPhase(st.kind === 'network' ? 'neterr' : 'idle');
      if (st.kind !== 'network') {
        toast({ message: 'Không lưu được, thử lại sau.' });
      }
    }
  }

  async function onDelete() {
    if (!isOwner) return;
    const ok = await confirm({
      title: `Xoá "${pin.title?.trim() || 'pin này'}"?`,
      body: 'Pin và bình luận trên đó sẽ không còn hiển thị.',
      yesLabel: 'Xoá pin',
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
      toast({ message: 'Đã xoá pin' }); // xoá = KHÔNG Hoàn tác (§1 toast)
      router.push('/');
    } catch {
      toast({ message: 'Không xoá được pin, thử lại sau.' });
    }
  }

  const imgUrl = pin.largeUrl ?? pin.mediumUrl ?? pin.imageUrl;
  const banner: BannerKind | null =
    !isOwner ? 'denied' : phase === 'done' ? 'done' : phase === 'neterr' ? 'neterr' : null;

  return (
    <div data-screen="B5" style={{ padding: '24px 16px 48px', maxWidth: 1000, margin: '0 auto' }}>
      <button type="button" onClick={() => router.push(`/pin/${pin.id}`)} style={{ ...outlineBtn, marginBottom: 16 }}>
        ← Quay lại pin
      </button>
      <h1
        style={{
          fontFamily: 'var(--font-display), var(--font-be-vietnam-pro), sans-serif',
          fontSize: 24,
          margin: 0,
          color: 'var(--color-foreground)',
        }}
      >
        Sửa pin
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--color-muted)', margin: '6px 0 20px' }}>
        Ảnh không đổi được sau khi tạo — muốn ảnh khác thì phải xoá pin và tạo lại.
      </p>

      {banner && (
        <div
          role={banner === 'done' ? 'status' : 'alert'}
          data-banner={banner}
          style={{
            fontSize: 12.5,
            padding: '11px 14px',
            borderRadius: 12,
            background: 'var(--color-surface-muted)',
            border: '1px solid var(--color-border)',
            color: banner === 'done' ? 'var(--color-success)' : 'var(--color-danger)',
            marginBottom: 16,
          }}
        >
          {BANNER_TEXT[banner]}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,420px) minmax(0,1fr)', gap: 28, alignItems: 'start' }}>
        {/* CỘT TRÁI — ảnh chỉ hiển thị, không bấm được */}
        <div>
          <img
            src={imgUrl}
            alt={pin.title ?? ''}
            style={{
              width: '100%',
              aspectRatio: `${pin.imageWidth} / ${pin.imageHeight}`,
              objectFit: 'cover',
              borderRadius: 20,
              display: 'block',
              background: 'var(--color-surface-muted)',
            }}
          />
          <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 8, lineHeight: 1.5 }}>
            Ảnh gốc giữ nguyên. Không thể thay ảnh ở màn này.
          </div>
        </div>

        {/* CỘT PHẢI — form */}
        <fieldset
          disabled={disabled}
          style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14, opacity: !isOwner ? 0.6 : 1 }}
        >
          <div>
            <label style={labelStyle} htmlFor="edit-title">Tiêu đề</label>
            <input
              id="edit-title"
              type="text"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Thêm tiêu đề"
              style={inputStyle}
            />
            <Counter n={title.length} max={TITLE_MAX} />
          </div>

          <div>
            <label style={labelStyle} htmlFor="edit-desc">Mô tả</label>
            <textarea
              id="edit-desc"
              value={description}
              maxLength={DESC_MAX}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Nói thêm về pin này"
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
            <Counter n={description.length} max={DESC_MAX} />
          </div>

          <div>
            <label style={labelStyle} htmlFor="edit-source">Link nguồn</label>
            <input
              id="edit-source"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://"
              style={inputStyle}
            />
            {!sourceUrlValid && (
              <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>
                Link nguồn phải là URL hợp lệ.
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle} htmlFor="edit-tags">Thẻ</label>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {tags.map((t) => (
                  <span key={t} style={chipStyle}>
                    #{t}
                    <button type="button" aria-label={`Bỏ thẻ ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))} style={chipRemoveBtn}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              id="edit-tags"
              type="text"
              value={tagInput}
              disabled={tags.length >= TAGS_MAX}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              placeholder={tags.length >= TAGS_MAX ? 'Đạt trần 10 thẻ' : 'Nhập thẻ rồi Enter'}
              style={inputStyle}
            />
            {tagSuggestions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {tagSuggestions.map((t) => (
                  <button key={t.id} type="button" onClick={() => addTag(t.name)} style={suggestChip}>
                    #{t.name}
                  </button>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 6 }}>
              {tags.length >= TAGS_MAX
                ? 'Đạt trần 10 thẻ — bỏ một thẻ trước khi thêm thẻ khác.'
                : `Còn ${TAGS_MAX - tags.length} thẻ`}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Danh mục</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(catsQuery.data?.categories ?? []).map((c) => {
                const active = categoryIds.includes(c.id);
                const atCap = !active && categoryIds.length >= CATS_MAX;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={active}
                    disabled={atCap}
                    onClick={() => toggleCategory(c.id)}
                    style={{
                      ...chipStyle,
                      cursor: atCap ? 'not-allowed' : 'pointer',
                      opacity: atCap ? 0.5 : 1,
                      border: active ? '1px solid var(--color-primary-strong)' : '1px solid var(--color-border)',
                      background: active ? 'var(--color-primary-soft)' : 'var(--color-surface)',
                    }}
                  >
                    {c.icon ? `${c.icon} ` : ''}
                    {c.name}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 6 }}>
              {categoryIds.length >= CATS_MAX ? 'Tối đa 3 danh mục cho mỗi pin.' : `Còn ${CATS_MAX - categoryIds.length} danh mục`}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
            <button
              type="button"
              onClick={onSave}
              disabled={disabled || !sourceUrlValid}
              style={{
                ...primaryBtn,
                background: phase === 'saving' ? 'var(--color-primary-soft)' : 'var(--color-primary)',
                color: phase === 'saving' ? 'var(--color-muted)' : 'var(--color-primary-foreground)',
                opacity: disabled || !sourceUrlValid ? 0.6 : 1,
                cursor: disabled || !sourceUrlValid ? 'not-allowed' : 'pointer',
              }}
            >
              {phase === 'saving' ? 'Đang lưu…' : phase === 'done' ? 'Đã lưu ✓' : 'Lưu thay đổi'}
            </button>
            <button type="button" onClick={() => router.push(`/pin/${pin.id}`)} style={outlineBtn}>
              Huỷ
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onDelete}
              style={{ ...outlineBtn, border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}
            >
              Xoá pin
            </button>
          </div>
        </fieldset>
      </div>
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

/** Màn chỉ có banner (notfound / neterr khi TẢI pin) — không có form. */
function BannerScreen({ kind, onBack, onRetry }: { kind: BannerKind; onBack?: () => void; onRetry?: () => void }) {
  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: '0 16px' }}>
      <div
        role="alert"
        data-banner={kind}
        style={{
          fontSize: 13.5,
          padding: '14px 16px',
          borderRadius: 12,
          background: 'var(--color-surface-muted)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-danger)',
          marginBottom: 16,
        }}
      >
        {BANNER_TEXT[kind]}
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} style={outlineBtn}>
          Thử lại
        </button>
      )}
      {onBack && (
        <button type="button" onClick={onBack} style={outlineBtn}>
          Về trang chủ
        </button>
      )}
    </div>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return (
    <div style={{ fontSize: 12, color: n >= max ? 'var(--color-danger)' : 'var(--color-muted)', textAlign: 'right', marginTop: 4 }}>
      {n}/{max}
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
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
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
const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 11px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-foreground)',
  fontSize: 12.5,
  fontWeight: 600,
};
const chipRemoveBtn: React.CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--color-muted)',
  cursor: 'pointer',
  fontSize: 15,
  lineHeight: 1,
  padding: 0,
};
const suggestChip: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 999,
  border: '1px dashed var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-muted)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
