'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  CreatePinDocument,
  type CreatePinMutation,
  type CreatePinMutationVariables,
  SavePinDocument,
  type SavePinMutation,
  type SavePinMutationVariables,
  CategoriesDocument,
  type CategoriesQuery,
  TagsDocument,
  type TagsQuery,
  type TagsQueryVariables,
} from '@/lib/gql/graphql';
import { measureImage, uploadImage, UploadError, type UploadErrorKind } from '@/lib/upload';
import { UPLOAD_ERROR_TEXT } from '@/lib/errors/upload-error-vi';
import { mapError } from '@/lib/errors/map-error';
import { formatBytes } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useBoardPicker, type BoardLite } from '@/components/board/board-picker';

/**
 * B4 — Tạo pin (mockup `view=create`, khuôn thừa từ B5 theo Q1). Trang RIÊNG,
 * luồng 2 bước: (1) chọn/tải ảnh → (2) điền form → `createPin`.
 *
 * Quyết định §0 (đã chốt 16/08/2026):
 *   • Q1 — chép khuôn B5: banner/bộ đếm/chip danh mục/trạng thái nút. 5 chuỗi lỗi
 *     upload đã DUYỆT (bảng UPLOAD_ERROR_TEXT).
 *   • Q2 (H1) — GIỮ ô Board: submit chạy `createPin` → nếu chọn board thì `savePin`
 *     nối tiếp; savePin fail thì VẪN điều hướng + toast SAVE_FAIL_TEXT. Mặc định
 *     KHÔNG chọn board.
 *   • Q4 (A2) — confirm rời trang: `beforeunload` cho hard-exit + chặn soft-nav
 *     (click <a> nội bộ, capture-phase) khi form dirty → mở confirm-dialog.
 *
 * 🔴 Ảnh KHÔNG qua GraphQL: `POST /uploads/local` (lib/upload) trả URL tuyệt đối
 * → `createPin.imageUrl`. `imageWidth`/`imageHeight` ĐO từ File (masonry cần tỉ lệ).
 * Đo + upload chạy SONG SONG; ưu tiên lỗi upload (server) để phơi 413/400 (T2.2).
 */

const TITLE_MAX = 200;
const DESC_MAX = 2000;
const TAGS_MAX = 10;
const CATS_MAX = 3;

/*
 * Q1 — 5 chuỗi lỗi upload đã DUYỆT 16/08/2026 nay ở `lib/errors/upload-error-vi.ts`.
 * FE-10 chuyển ra đó vì luồng đổi ảnh đại diện (C1a + C2) dùng CHUNG bảng này;
 * để cục bộ ở đây thì bản thứ hai sẽ trôi khỏi bản này.
 */
/** Q1 — trần ngày (403 createPin), đã duyệt. */
const DAILY_CAP_TEXT = 'Bạn đã đạt trần 20 pin hôm nay — quay lại vào ngày mai.';
/** Q2 — savePin fail sau createPin, đã duyệt. */
const SAVE_FAIL_TEXT = 'Đã tạo pin, nhưng chưa lưu được vào board — thử lại từ trang pin.';

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Hint "3:4 · 1.240 × 1.653 · 2,4MB" (§3.1). Tỉ lệ chỉ hiện nếu rút gọn đẹp. */
function imageHint(w: number, h: number, bytes: number): string {
  const g = gcd(w, h) || 1;
  const rw = w / g;
  const rh = h / g;
  const ratio = rw <= 40 && rh <= 40 ? `${rw}:${rh} · ` : '';
  return `${ratio}${w.toLocaleString('vi-VN')} × ${h.toLocaleString('vi-VN')} · ${formatBytes(bytes)}`;
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

export function CreatePinView() {
  const router = useRouter();
  const { data: session } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { openBoardPicker } = useBoardPicker();

  // --- Upload / ảnh ---
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [uploadErr, setUploadErr] = useState<UploadErrorKind | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Form ---
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [board, setBoard] = useState<BoardLite | null>(null);

  // --- Submit ---
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

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

  const [createPin] = useMutation<CreatePinMutation, CreatePinMutationVariables>(CreatePinDocument);
  const [savePin] = useMutation<SavePinMutation, SavePinMutationVariables>(SavePinDocument);

  const sourceUrlValid = sourceUrl.trim() === '' || isValidHttpUrl(sourceUrl.trim());
  const canSubmit =
    uploadPhase === 'done' && !!uploadedUrl && !!dims && !submitting && sourceUrlValid;

  // Dirty = có ảnh HOẶC bất kỳ trường nào có nội dung (Q4).
  const dirty =
    file !== null ||
    title.trim() !== '' ||
    description.trim() !== '' ||
    sourceUrl.trim() !== '' ||
    tags.length > 0 ||
    categoryIds.length > 0 ||
    board !== null;
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Dọn object URL của preview khi đổi ảnh / rời trang.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Q4 — hard-exit (đóng tab/F5/URL ngoài): hộp thoại native của trình duyệt.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Q4 — soft-nav nội bộ: chặn click <a> nội bộ ở CAPTURE phase (trước Next Link)
  // khi form dirty → confirm-dialog. Chỉ trong phạm vi trang này (gỡ khi unmount).
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      const href = anchor?.getAttribute('href');
      if (!href || !href.startsWith('/') || href === '/pin/new') return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const ok = await confirm({
          title: 'Rời trang khi chưa đăng?',
          body: 'Ảnh đã chọn và nội dung bạn nhập sẽ mất.',
          yesLabel: 'Rời trang',
          cancelLabel: 'Ở lại',
          danger: true,
        });
        if (ok) router.push(href);
      })();
    };
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [confirm, router]);

  async function onFileChosen(f: File) {
    setUploadErr(null);
    setUploadedUrl(null);
    setDims(null);
    setSubmitErr(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setUploadPhase('working');

    // Đo + upload SONG SONG. Ưu tiên lỗi upload (server) để phơi 413/400 (T2.2) —
    // .txt sẽ hỏng cả hai, nhưng lỗi server "Unsupported file type" cụ thể hơn.
    const [measured, uploaded] = await Promise.allSettled([
      measureImage(f),
      uploadImage(f, session?.accessToken),
    ]);

    if (uploaded.status === 'rejected') {
      const kind = uploaded.reason instanceof UploadError ? uploaded.reason.kind : 'unknown';
      setUploadPhase('error');
      setUploadErr(kind);
      return;
    }
    if (measured.status === 'rejected') {
      setUploadPhase('error');
      setUploadErr('unknown');
      return;
    }
    setDims(measured.value);
    setUploadedUrl(uploaded.value.url);
    setUploadPhase('done');
  }

  function pickFileFromInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // cho phép chọn lại cùng file
    if (f) void onFileChosen(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void onFileChosen(f);
  }

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
    if (categoryIds.includes(id)) {
      setCategoryIds(categoryIds.filter((c) => c !== id));
    } else if (categoryIds.length < CATS_MAX) {
      setCategoryIds([...categoryIds, id]);
    }
  }

  async function onSubmit() {
    if (!canSubmit || !uploadedUrl || !dims) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const res = await createPin({
        variables: {
          input: {
            imageUrl: uploadedUrl,
            imageWidth: dims.width,
            imageHeight: dims.height,
            title: title.trim() || undefined,
            description: description.trim() || undefined,
            sourceUrl: sourceUrl.trim() || undefined,
            tagNames: tags.length > 0 ? tags : undefined,
            categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
          },
        },
      });
      const created = res.data?.createPin;
      if (!created) throw new Error('createPin trả rỗng');

      // Q2 H1: chọn board ⇒ savePin nối tiếp; fail thì VẪN điều hướng + toast.
      if (board) {
        try {
          await savePin({ variables: { input: { pinId: created.id, boardId: board.id } } });
        } catch {
          toast({ message: SAVE_FAIL_TEXT });
        }
      }
      // Điều hướng tới HỒ SƠ người tạo — KHÔNG dùng /pin/[id]: soft-nav tới đó bị
      // interceptor @modal/(.)pin/[id] biến thành MODAL đè trang tạo, để B4 kẹt ở
      // "Đang đăng…" (không unmount). Hồ sơ không bị chặn ⇒ B4 unmount sạch, và
      // khớp T2.1 "pin mới hiện trên /@<mình>". router.push (không phải click <a>)
      // ⇒ không kích guard rời trang.
      const uname = created.creator.username;
      router.push(uname ? `/@${uname}` : '/');
    } catch (err) {
      const st = mapError(err);
      setSubmitErr(st.kind === 'rate-limit' ? DAILY_CAP_TEXT : 'Không đăng được pin, thử lại sau.');
      setSubmitting(false);
    }
  }

  const tagSuggestions = useMemo(() => {
    const existing = new Set(tags.map((t) => t.toLowerCase()));
    return (tagsSug.data?.tags ?? []).filter((t) => !existing.has(t.name.toLowerCase())).slice(0, 6);
  }, [tagsSug.data, tags]);

  return (
    <div style={{ padding: '24px 16px 48px', maxWidth: 1000, margin: '0 auto' }}>
      <h1
        style={{
          fontFamily: 'var(--font-display), var(--font-be-vietnam-pro), sans-serif',
          fontSize: 24,
          margin: 0,
          color: 'var(--color-foreground)',
        }}
      >
        Tạo pin
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--color-muted)', margin: '6px 0 24px' }}>
        Trang riêng, không phải modal. Rời trang khi đã chọn ảnh sẽ hỏi xác nhận.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,420px) minmax(0,1fr)',
          gap: 28,
          alignItems: 'start',
        }}
      >
        {/* ---- CỘT TRÁI: upload ---- */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          style={{
            border: uploadPhase === 'done' ? '2px dashed transparent' : '2px dashed var(--color-border)',
            borderRadius: 20,
            minHeight: 340,
            padding: 26,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            textAlign: 'center',
            background: uploadPhase === 'done' ? 'var(--color-surface-muted)' : 'transparent',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={pickFileFromInput}
            style={{ display: 'none' }}
          />

          {uploadPhase === 'done' && previewUrl ? (
            <>
              <img
                src={previewUrl}
                alt="Xem trước ảnh sắp đăng"
                style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 12, objectFit: 'contain' }}
              />
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-foreground)' }}>Đã tải lên</div>
              {dims && file && (
                <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
                  {imageHint(dims.width, dims.height, file.size)}
                </div>
              )}
              <button type="button" onClick={() => fileInputRef.current?.click()} style={outlineBtn}>
                Đổi ảnh khác
              </button>
            </>
          ) : uploadPhase === 'working' ? (
            <div style={{ width: '100%' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12.5,
                  color: 'var(--color-muted)',
                  marginBottom: 8,
                }}
              >
                <span>Đang tải lên</span>
              </div>
              <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--color-surface-muted)', overflow: 'hidden' }}>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    width: '40%',
                    borderRadius: 3,
                    background: 'var(--color-primary-strong)',
                    animation: 'upload-indeterminate 1.1s ease-in-out infinite',
                  }}
                />
              </div>
            </div>
          ) : (
            <>
              <div
                aria-hidden
                style={{ fontSize: 30, lineHeight: 1, color: 'var(--color-primary-strong)' }}
              >
                ↑
              </div>
              {uploadPhase === 'error' && uploadErr ? (
                <div
                  role="alert"
                  data-upload-error={uploadErr}
                  style={{
                    fontSize: 12.5,
                    padding: '11px 14px',
                    borderRadius: 12,
                    background: 'var(--color-surface-muted)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-danger)',
                  }}
                >
                  {UPLOAD_ERROR_TEXT[uploadErr]}
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-foreground)' }}>
                    Kéo thả ảnh vào đây
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
                    Hoặc chọn từ máy. Bước 1 của 2.
                  </div>
                </>
              )}
              <button type="button" onClick={() => fileInputRef.current?.click()} style={primaryBtn}>
                {uploadPhase === 'error' ? 'Chọn ảnh khác' : 'Chọn ảnh'}
              </button>
            </>
          )}
        </div>

        {/* ---- CỘT PHẢI: form ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle} htmlFor="pin-title">
              Tiêu đề
            </label>
            <input
              id="pin-title"
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
            <label style={labelStyle} htmlFor="pin-desc">
              Mô tả
            </label>
            <textarea
              id="pin-desc"
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
            <label style={labelStyle} htmlFor="pin-source">
              Link nguồn
            </label>
            <input
              id="pin-source"
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

          {/* Thẻ — autocomplete tags(query), tối đa 10 (§4.4, KHÔNG chép 6 nhãn cứng) */}
          <div>
            <label style={labelStyle} htmlFor="pin-tags">
              Thẻ
            </label>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {tags.map((t) => (
                  <span key={t} style={chipStyle}>
                    #{t}
                    <button
                      type="button"
                      aria-label={`Bỏ thẻ ${t}`}
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                      style={chipRemoveBtn}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              id="pin-tags"
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
              placeholder={tags.length >= TAGS_MAX ? 'Đã đủ thẻ' : 'Nhập thẻ rồi Enter'}
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
              Còn {TAGS_MAX - tags.length} thẻ
            </div>
          </div>

          {/* Danh mục — chip toggle, tối đa 3 (§4.5) */}
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
              Còn {CATS_MAX - categoryIds.length} danh mục
            </div>
          </div>

          {/* Board — Q2 H1: mặc định không chọn; mở picker chế độ 'select' */}
          <div>
            <label style={labelStyle}>Board</label>
            <button
              type="button"
              onClick={() =>
                openBoardPicker({
                  mode: 'select',
                  selectedBoardId: board?.id ?? null,
                  onSelect: setBoard,
                })
              }
              style={{ ...inputStyle, textAlign: 'left', cursor: 'pointer', color: board ? 'var(--color-foreground)' : 'var(--color-muted)' }}
            >
              {board ? board.name : 'Chọn board (tuỳ chọn)'} ▾
            </button>
          </div>

          <div
            style={{
              fontSize: 12,
              color: 'var(--color-muted)',
              marginTop: 2,
              lineHeight: 1.5,
            }}
          >
            Tối đa 10MB · tối thiểu 1KB · chỉ nhận JPG, PNG, WEBP, GIF · tối đa 20 pin/ngày.
          </div>

          {submitErr && (
            <div
              role="alert"
              style={{
                fontSize: 12.5,
                padding: '11px 14px',
                borderRadius: 12,
                background: 'var(--color-surface-muted)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-danger)',
              }}
            >
              {submitErr}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              style={{
                ...primaryBtn,
                opacity: canSubmit ? 1 : 0.55,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                background: submitting ? 'var(--color-primary-soft)' : 'var(--color-primary)',
                color: submitting ? 'var(--color-muted)' : 'var(--color-primary-foreground)',
              }}
            >
              {submitting ? 'Đang đăng…' : 'Đăng'}
            </button>
            <button type="button" onClick={() => void leaveTo('/')} style={outlineBtn}>
              Huỷ
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Huỷ là <button> (guard chỉ bắt <a>) ⇒ tự hỏi confirm khi dirty.
  async function leaveTo(href: string) {
    if (dirtyRef.current) {
      const ok = await confirm({
        title: 'Rời trang khi chưa đăng?',
        body: 'Ảnh đã chọn và nội dung bạn nhập sẽ mất.',
        yesLabel: 'Rời trang',
        cancelLabel: 'Ở lại',
        danger: true,
      });
      if (!ok) return;
    }
    router.push(href);
  }
}

function Counter({ n, max }: { n: number; max: number }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: n >= max ? 'var(--color-danger)' : 'var(--color-muted)',
        textAlign: 'right',
        marginTop: 4,
      }}
    >
      {n}/{max}
    </div>
  );
}

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
