'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  CreatePinDocument,
  type CreatePinMutation,
  type CreatePinMutationVariables,
  SavePinDocument,
  type SavePinMutation,
  type SavePinMutationVariables,
  TagsDocument,
  type TagsQuery,
  type TagsQueryVariables,
  Visibility,
} from '@/lib/gql/graphql';
import { UploadError, type UploadErrorKind } from '@/lib/upload';
import { prepareAndUploadImage, type PreparedImage } from '@/lib/image/prepare';
import { UPLOAD_ERROR_KEY } from '@/lib/errors/upload-error';
import { useLocale, useT } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n/config';
import { mapError } from '@/lib/errors/map-error';
import { formatBytes } from '@/lib/format';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useBoardPicker, type BoardLite } from '@/components/board/board-picker';
import {
  AudiencePicker,
  audienceSummary,
  audienceToInput,
  DEFAULT_AUDIENCE,
  isAudienceComplete,
  useMyCircles,
  type AudienceValue,
} from '@/components/pin/audience-picker';
import { CaptureView } from '@/components/pin/capture-view';

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
 * 🔴 GỠ 25/08/2026 (luồng B) — ô "Link nguồn" (`sourceUrl`) và chip "Danh mục"
 * (`categoryIds`) KHÔNG còn ở form này, và cũng không còn được gửi trong
 * `createPin`. Cả hai field vẫn OPTIONAL ở backend/DB và dữ liệu cũ giữ
 * nguyên: màn chi tiết vẫn hiện dòng "Nguồn:" cho pin cũ còn `sourceUrl`,
 * query `Categories` vẫn sống cho việc gán nhãn sau này. Chỉ chỗ NHẬP bị gỡ.
 *
 * 🔴 Ảnh KHÔNG qua GraphQL: `POST /uploads/local` (lib/upload) trả URL tuyệt đối
 * → `createPin.imageUrl`. `imageWidth`/`imageHeight` ĐO từ File (masonry cần tỉ lệ).
 * Đo + upload chạy SONG SONG; ưu tiên lỗi upload (server) để phơi 413/400 (T2.2).
 */

const TITLE_MAX = 200;
const DESC_MAX = 2000;
const TAGS_MAX = 10;

/*
 * Q1 — 5 chuỗi lỗi upload đã DUYỆT 16/08/2026 nay ở `lib/errors/upload-error-vi.ts`.
 * FE-10 chuyển ra đó vì luồng đổi ảnh đại diện (C1a + C2) dùng CHUNG bảng này;
 * để cục bộ ở đây thì bản thứ hai sẽ trôi khỏi bản này.
 */
/*
 * i18n (23/08/2026) — hai chuỗi đã duyệt (Q1 trần ngày, Q2 savePin hỏng sau
 * createPin) nay nằm ở từ điển: `pin.tooManyPins` và `pin.saveToBoardFailed`.
 * Nội dung KHÔNG đổi, chỉ đổi chỗ chứa.
 */

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Hint "3:4 · 1.240 × 1.653 · 2,4MB" (§3.1). Tỉ lệ chỉ hiện nếu rút gọn đẹp.
 *
 * i18n (23/08/2026): dấu ngăn nghìn và dấu thập phân của MB đổi theo ngôn ngữ —
 * vi-VN cho "1.240 × 1.653 · 2,4MB", en-US cho "1,240 × 1,653 · 2.4MB". Để
 * nguyên 'vi-VN' thì bản tiếng Anh hiện dấu chấm/phẩy ngược nghĩa với người đọc.
 */
function imageHint(w: number, h: number, bytes: number, locale: Locale): string {
  const g = gcd(w, h) || 1;
  const rw = w / g;
  const rh = h / g;
  const ratio = rw <= 40 && rh <= 40 ? `${rw}:${rh} · ` : '';
  const bcp47 = locale === 'vi' ? 'vi-VN' : 'en-US';
  return `${ratio}${w.toLocaleString(bcp47)} × ${h.toLocaleString(bcp47)} · ${formatBytes(bytes, locale)}`;
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
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { openBoardPicker } = useBoardPicker();

  // --- Upload / ảnh ---
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /**
   * F1 · XH-9b — thay cặp `dims` + `uploadedUrl` cũ bằng KẾT QUẢ TRỌN GÓI của
   * một tiến trình: ảnh gốc + 3 URL biến thể + số đo ảnh GỐC (đã áp EXIF).
   */
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [uploadErr, setUploadErr] = useState<UploadErrorKind | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 'capture' = màn XH-CAM đang chiếm chỗ form. Cùng một trang, cùng một luồng đăng. */
  const [mode, setMode] = useState<'form' | 'capture'>('form');

  // --- Form ---
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [board, setBoard] = useState<BoardLite | null>(null);
  /**
   * Khán giả — LUÔN bắt đầu ở PUBLIC. Không có "nhớ khán giả lần trước" ở v1
   * (XH-QĐ-18, chốt 24/08/2026); lý do đầy đủ ở `audience-picker.tsx`.
   *
   * NGOẠI LỆ DUY NHẤT: `?circle=<id>` trên URL (chốt 25/08/2026, đóng điểm treo
   * §7 mục 4). Nút "Đăng cho vòng này" ở card rỗng của feed vòng trước đây đẩy
   * sang `/pin/new` trần, nên người dùng vừa nói rõ mình muốn đăng cho vòng nào
   * thì màn tạo pin lại hỏi lại từ đầu.
   *
   * Đây KHÔNG phải "nhớ khán giả lần trước" mà XH-QĐ-18 cấm: nó không đọc lịch
   * sử, không suy đoán, chỉ mang theo đúng ý định người dùng vừa phát ra ở cú
   * bấm ngay trước đó — và chỉ đi được về phía RIÊNG TƯ HƠN (PUBLIC → CIRCLE),
   * không bao giờ ngược lại.
   */
  const [audience, setAudience] = useState<AudienceValue>(() => {
    const preset = searchParams.get('circle');
    return preset ? { ...DEFAULT_AUDIENCE, visibility: Visibility.Circle, circleId: preset } : DEFAULT_AUDIENCE;
  });

  // --- Submit ---
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

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

  const { circles, loaded: circlesLoaded } = useMyCircles();

  /**
   * Gỡ `?circle=<id>` nếu id đó KHÔNG phải vòng của mình.
   *
   * Backend chỉ nhận `audienceCircleId` của vòng người gửi SỞ HỮU, còn feed
   * vòng ở trang chủ hiện cả vòng mình chỉ là THÀNH VIÊN — nên một cú bấm hợp
   * lệ ở đó vẫn có thể mang sang đây một id không đăng được. Không gỡ thì người
   * dùng chỉ biết điều đó khi bấm Đăng và ăn lỗi từ server.
   *
   * ⚠️ Chạy ĐÚNG MỘT LẦN, canh bằng ref: sau lần đầu thì `audience` thuộc về
   * người dùng, effect này không được quyền đụng nữa. Đây cũng là lý do nó
   * không "suy ra lúc render" — cùng bài học của chip vòng ở `home-view.tsx`:
   * giá trị đang sửa dở của người dùng không phải thứ suy ra được từ URL.
   *
   * ⚠️ Canh bằng `loaded`, KHÔNG bằng `!loading`. `cache-and-network` với cache
   * rỗng có một nhịp `loading === false` mà `data` vẫn `undefined` ⇒ danh sách
   * vòng đọc ra RỖNG ⇒ effect này gỡ mất vòng chọn sẵn của chính người dùng
   * vừa bấm. Bản đầu viết `!circlesLoading` và hỏng đúng như vậy trên trình
   * duyệt: URL có `?circle=`, form vẫn hiện "Công khai".
   */
  const presetCheckedRef = useRef(false);
  useEffect(() => {
    if (presetCheckedRef.current || !circlesLoaded) return;
    presetCheckedRef.current = true;
    const preset = searchParams.get('circle');
    if (!preset) return;
    if (!circles.some((c) => c.id === preset)) setAudience(DEFAULT_AUDIENCE);
  }, [circles, circlesLoaded, searchParams]);

  const canSubmit =
    uploadPhase === 'done' &&
    !!prepared &&
    !submitting &&
    // CIRCLE mà chưa chọn vòng lẫn chưa chọn người ⇒ backend 400. Khoá ở đây.
    isAudienceComplete(audience);

  // Dirty = có ảnh HOẶC bất kỳ trường nào có nội dung (Q4).
  const dirty =
    file !== null ||
    title.trim() !== '' ||
    description.trim() !== '' ||
    tags.length > 0 ||
    board !== null ||
    audience.visibility !== DEFAULT_AUDIENCE.visibility ||
    audience.expiresAt !== null;
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
          title: t('pin.leaveTitle'),
          body: t('pin.leaveBody'),
          yesLabel: t('pin.leaveYes'),
          cancelLabel: t('pin.leaveNo'),
          danger: true,
        });
        if (ok) router.push(href);
      })();
    };
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [confirm, router]);

  /**
   * MỘT tiến trình cho cả thu nhỏ lẫn tải lên (spec capture mục 4) — dùng chung
   * cho ảnh chọn từ đĩa và ảnh vừa chụp, đúng luật "không có luồng đăng thứ hai".
   */
  async function onFileChosen(f: File) {
    setUploadErr(null);
    setPrepared(null);
    setSubmitErr(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setUploadPhase('working');

    try {
      setPrepared(await prepareAndUploadImage(f, session?.accessToken));
      setUploadPhase('done');
    } catch (err) {
      // Lỗi server (413/400) cụ thể hơn lỗi giải mã ⇒ ưu tiên `kind` của nó (T2.2).
      setUploadPhase('error');
      setUploadErr(err instanceof UploadError ? err.kind : 'unknown');
    }
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
    const tag = raw.trim();
    if (!tag || tags.length >= TAGS_MAX) return;
    if (tags.some((x) => x.toLowerCase() === tag.toLowerCase())) {
      setTagInput('');
      return;
    }
    setTags([...tags, tag]);
    setTagInput('');
  }

  async function onSubmit() {
    if (!canSubmit || !prepared) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const res = await createPin({
        variables: {
          input: {
            imageUrl: prepared.imageUrl,
            // 🔴 Số đo ảnh GỐC, KHÔNG phải của bản thu nhỏ (PLAN_XAHOI §8 bẫy 3).
            imageWidth: prepared.width,
            imageHeight: prepared.height,
            thumbnailUrl: prepared.thumbnailUrl,
            mediumUrl: prepared.mediumUrl,
            largeUrl: prepared.largeUrl,
            ...audienceToInput(audience),
            title: title.trim() || undefined,
            description: description.trim() || undefined,
            tagNames: tags.length > 0 ? tags : undefined,
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
          toast({ message: t('pin.saveToBoardFailed') });
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
      // Trần 10 pin/phút (XH-4b): backend gửi kèm số giây còn lại, và đó là
      // thứ DUY NHẤT người dùng làm được gì với nó. Không có số (API cũ, hoặc
      // thông điệp đổi) thì rơi về bản không nêu thời gian — đừng bịa ra số.
      setSubmitErr(
        st.kind === 'rate-limit'
          ? st.retryAfterSec != null
            ? t('pin.tooManyPins', { seconds: st.retryAfterSec })
            : t('pin.tooManyPinsNoTime')
          : t('pin.createFailed'),
      );
      setSubmitting(false);
    }
  }

  const tagSuggestions = useMemo(() => {
    const existing = new Set(tags.map((tag) => tag.toLowerCase()));
    return (tagsSug.data?.tags ?? [])
      .filter((sug) => !existing.has(sug.name.toLowerCase()))
      .slice(0, 6);
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
        {t('pin.createTitle')}
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--color-muted)', margin: '6px 0 24px' }}>
        {t('pin.createSubtitle')}
      </p>

      {mode === 'capture' ? (
        <CaptureView
          onCapture={(f) => {
            setMode('form');
            void onFileChosen(f);
          }}
          onFallback={() => {
            setMode('form');
            fileInputRef.current?.click();
          }}
        />
      ) : (
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
                alt={t('pin.previewAlt')}
                style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 12, objectFit: 'contain' }}
              />
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-foreground)' }}>{t('pin.uploaded')}</div>
              {prepared && file && (
                <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
                  {imageHint(prepared.width, prepared.height, file.size, locale)}
                </div>
              )}
              <button type="button" onClick={() => fileInputRef.current?.click()} style={outlineBtn}>
                {t('pin.changeImage')}
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
                <span>{t('pin.uploading')}</span>
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
                  {t(UPLOAD_ERROR_KEY[uploadErr])}
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-foreground)' }}>
                    {t('pin.dropImage')}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
                    {t('pin.dropImageHint')}
                  </div>
                </>
              )}
              {/* QĐ-27 — lối vào màn chụp nằm NGAY CẠNH ô chọn file, không phải
                  một lối vào riêng. Nhãn là "Chụp ảnh" chứ không phải "Chụp /
                  Quay" của bản vẽ: phần quay video chưa thi công ở F1 (video
                  làm sau xahoi), và hứa một thứ chưa có là tệ hơn thiếu chữ. */}
              <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button type="button" onClick={() => fileInputRef.current?.click()} style={primaryBtn}>
                  {uploadPhase === 'error' ? t('pin.pickAnotherImage') : t('pin.pickImage')}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('capture')}
                  data-testid="open-capture"
                  style={{ ...outlineBtn, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <svg
                    width={16}
                    height={16}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M4 8h3l1.5-2h7L17 8h3v11H4z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
                  </svg>
                  {t('capture.open')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* ---- CỘT PHẢI: form ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle} htmlFor="pin-title">
              {t('pin.fieldTitle')}
            </label>
            <input
              id="pin-title"
              type="text"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('pin.fieldTitlePlaceholder')}
              style={inputStyle}
            />
            <Counter n={title.length} max={TITLE_MAX} />
          </div>

          <div>
            <label style={labelStyle} htmlFor="pin-desc">
              {t('pin.fieldDescription')}
            </label>
            <textarea
              id="pin-desc"
              value={description}
              maxLength={DESC_MAX}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('pin.fieldDescriptionPlaceholder')}
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
            <Counter n={description.length} max={DESC_MAX} />
          </div>

          {/* Thẻ — autocomplete tags(query), tối đa 10 (§4.4, KHÔNG chép 6 nhãn cứng) */}
          <div>
            <label style={labelStyle} htmlFor="pin-tags">
              {t('pin.fieldTags')}
            </label>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {tags.map((tag) => (
                  <span key={tag} style={chipStyle}>
                    #{tag}
                    <button
                      type="button"
                      aria-label={t('pin.removeTag', { tag })}
                      onClick={() => setTags(tags.filter((x) => x !== tag))}
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
              placeholder={
                tags.length >= TAGS_MAX ? t('pin.tagsFull') : t('pin.tagInputPlaceholder')
              }
              style={inputStyle}
            />
            {tagSuggestions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {tagSuggestions.map((sug) => (
                  <button key={sug.id} type="button" onClick={() => addTag(sug.name)} style={suggestChip}>
                    #{sug.name}
                  </button>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 6 }}>
              {t('pin.tagsLeft', { count: TAGS_MAX - tags.length, n: TAGS_MAX - tags.length })}
            </div>
          </div>

          {/* XH-AUD — bộ chọn khán giả. Đặt SÁT nhóm nút Đăng bên dưới, không
              nhét vào menu phụ: đây là ràng buộc cứng của mục chống đăng nhầm. */}
          <AudiencePicker value={audience} onChange={setAudience} />

          {/* Board — Q2 H1: mặc định không chọn; mở picker chế độ 'select' */}
          <div>
            <label style={labelStyle}>{t('pin.fieldBoard')}</label>
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
              {board ? board.name : t('pin.pickBoardOptional')} ▾
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
            {t('pin.uploadLimits')}
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

          <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
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
              {submitting ? t('pin.publishing') : t('pin.publish')}
            </button>
            <button type="button" onClick={() => void leaveTo('/')} style={outlineBtn}>
              {t('common.cancel')}
            </button>
            {/* Ràng buộc cứng: khán giả hiện NGAY CẠNH nút Đăng, không giấu
                trong menu phụ (PLAN_XAHOI §9 — chống đăng nhầm). Cùng một hàm
                với nhãn trên bộ chọn, nên hai chỗ không thể nói khác nhau. */}
            <div
              data-testid="publish-audience-label"
              style={{ fontSize: 12.5, color: 'var(--color-muted)', fontWeight: 600 }}
            >
              {audienceSummary(t, audience, circles)}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );

  // Huỷ là <button> (guard chỉ bắt <a>) ⇒ tự hỏi confirm khi dirty.
  async function leaveTo(href: string) {
    if (dirtyRef.current) {
      const ok = await confirm({
        title: t('pin.leaveTitle'),
        body: t('pin.leaveBody'),
        yesLabel: t('pin.leaveYes'),
        cancelLabel: t('pin.leaveNo'),
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
