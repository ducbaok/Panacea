'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';

/**
 * XH-CAM — CHỤP ẢNH bằng `getUserMedia` (bản vẽ `Panacea-v3.1.html`).
 *
 * 🔴 PHẠM VI: chỉ phần CHỤP ẢNH. Bản vẽ có sẵn phần QUAY VIDEO (toggle Ảnh/
 * Video, mốc 10/15/30s, chọn poster) nhưng **video làm SAU đợt xã hội** —
 * quyết định 24/08/2026, ghi ở `docs/ban-do-man-panacea.md` §2b và
 * `xahoi-dieu-phoi.md` §2. Vì thế:
 *   • KHÔNG render toggle Ảnh/Video (một nút mờ vĩnh viễn không nói được điều
 *     gì thật; nút "sắp có" là thứ bản vẽ không hề vẽ).
 *   • Nhãn lối vào ở màn tạo pin là "Chụp ảnh", KHÔNG phải "Chụp / Quay" của
 *     bản vẽ — hứa quay video khi chưa có khâu quay là hứa suông.
 * Khi làm video: khôi phục nhãn của bản vẽ và dựng thêm 6 trạng thái vlive/
 * vrec/vreview/norec + thanh chọn poster.
 *
 * Bốn trạng thái dựng ở đây (khớp mục 1/2/3/6 của `spec-man-xahoi-capture.md`):
 *   prompt   — chưa xin quyền, kèm đường lui "Chọn ảnh từ máy"
 *   denied   — người dùng/trình duyệt từ chối, kèm cách bật lại
 *   live     — khung ngắm + nút chụp
 *   review   — xem lại: "Dùng ảnh này" / "Chụp lại"  (Q2 = CÓ, QĐ-27)
 * Trạng thái xử lý/upload và lỗi upload KHÔNG ở màn này: ảnh "dùng" được trả
 * về màn tạo pin và đi CHUNG một tiến trình thu nhỏ + tải lên với ảnh chọn từ
 * đĩa — spec §3 cấm dựng luồng đăng thứ hai.
 *
 * ⚠️ `getUserMedia` chỉ tồn tại trên HTTPS hoặc localhost. Máy dev này chạy
 * localhost nên đo được; điện thoại thật thì chưa (`spec-man-xahoi-capture.md`
 * §1). `isSecureContext` sai ⇒ hiện thẳng lý do chứ không để nút chụp im lặng
 * không làm gì.
 *
 * ⚠️ Ảnh do canvas sinh KHÔNG có thẻ EXIF (canvas vẽ pixel đã đúng chiều), nên
 * đường chụp không dính bẫy orientation — `lib/image/resize.ts` xử lý cả hai
 * đường bằng cùng một hàm mà không cần nhánh riêng.
 */

type CamState = 'prompt' | 'denied' | 'live' | 'review';

type Props = {
  /** Ảnh người dùng chấp nhận — màn tạo pin nhận và chạy tiếp pipeline chung. */
  onCapture: (file: File) => void;
  /** "Chọn ảnh từ máy" / "Quay lại tạo pin" — đường lui về ô chọn file. */
  onFallback: () => void;
};

export function CaptureView({ onCapture, onFallback }: Props) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CamState>('prompt');
  const [shot, setShot] = useState<{ url: string; file: File } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const hasGetUserMedia =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  /**
   * null = chưa dò xong. QĐ-27 muốn máy KHÔNG có camera thì nút chụp đã MỜ sẵn
   * kèm giải thích, chứ không phải bấm rồi mới nhận lỗi — nên phải dò thiết bị
   * TRƯỚC, bằng `enumerateDevices` (chạy được khi chưa xin quyền: nhãn thiết bị
   * bị giấu nhưng `kind` thì không).
   */
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const cameraUnavailable = !secure || !hasGetUserMedia || hasCamera === false;

  useEffect(() => {
    // Không setState ĐỒNG BỘ trong effect: `hasGetUserMedia` đã có sẵn ở
    // `cameraUnavailable` bên dưới, nên nhánh "không dò được" chỉ cần thoát.
    if (!hasGetUserMedia || !navigator.mediaDevices?.enumerateDevices) return;
    let alive = true;
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (alive) setHasCamera(devices.some((d) => d.kind === 'videoinput'));
      })
      .catch(() => {
        // Dò hỏng thì đừng khoá đường đi: để người dùng bấm và nhận lỗi thật.
        if (alive) setHasCamera(true);
      });
    return () => {
      alive = false;
    };
  }, [hasGetUserMedia]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Tắt camera khi rời màn. Thiếu bước này là đèn camera sáng mãi sau khi người
  // dùng đã quay về form — vừa là lỗi riêng tư, vừa giữ thiết bị cho tab khác.
  useEffect(() => stopStream, [stopStream]);

  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  const start = async () => {
    setStartError(null);
    if (cameraUnavailable) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setState('live');
      // Gán sau khi state đổi để phần tử <video> đã có trong DOM.
      window.setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          void videoRef.current.play().catch(() => undefined);
        }
      }, 0);
    } catch (err) {
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied');
      else setStartError(t('capture.startFailed'));
    }
  };

  const shoot = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `capture-${canvas.width}x${canvas.height}.jpg`, {
          type: 'image/jpeg',
        });
        setShot({ url: URL.createObjectURL(file), file });
        setState('review');
        stopStream();
      },
      'image/jpeg',
      0.92,
    );
  };

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    void start();
  };

  return (
    <div data-screen="XH-CAM" data-state={state} style={{ maxWidth: 560 }}>
      <button
        type="button"
        onClick={() => {
          stopStream();
          onFallback();
        }}
        style={backLinkStyle}
      >
        ← {t('capture.back')}
      </button>
      <h2
        style={{
          fontFamily: "'Varela Round', sans-serif",
          fontSize: 24,
          margin: '0 0 4px',
          color: 'var(--color-foreground)',
        }}
      >
        {t('capture.title')}
      </h2>
      <p style={{ fontSize: 13.5, color: 'var(--color-muted)', margin: '0 0 18px' }}>
        {t('capture.subtitle')}
      </p>

      {state === 'prompt' && (
        <div style={{ ...cardStyle, padding: '36px 28px', textAlign: 'center' }}>
          <CameraIcon />
          <div style={{ fontWeight: 700, fontSize: 16, marginTop: 14 }}>
            {t('capture.promptTitle')}
          </div>
          <div
            style={{
              fontSize: 13.5,
              color: 'var(--color-muted)',
              marginTop: 8,
              lineHeight: 1.6,
            }}
          >
            {t('capture.promptBody')}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 9,
              justifyContent: 'center',
              marginTop: 18,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => void start()}
              disabled={cameraUnavailable}
              style={{
                ...primaryBtn,
                opacity: cameraUnavailable ? 0.5 : 1,
                cursor: cameraUnavailable ? 'not-allowed' : 'pointer',
              }}
            >
              {t('capture.allow')}
            </button>
            <button type="button" onClick={onFallback} style={outlineBtn}>
              {t('capture.pickFromDisk')}
            </button>
          </div>
          {cameraUnavailable && (
            <div data-testid="capture-unavailable" style={noteStyle}>
              {secure && hasGetUserMedia ? t('capture.noCamNote') : t('capture.insecureNote')}
            </div>
          )}
          {startError && (
            <div role="alert" style={{ ...noteStyle, color: 'var(--color-danger)' }}>
              {startError}
            </div>
          )}
        </div>
      )}

      {state === 'denied' && (
        <div style={{ ...cardStyle, padding: '32px 28px' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{t('capture.deniedTitle')}</div>
          <div
            style={{
              fontSize: 13.5,
              color: 'var(--color-muted)',
              marginTop: 8,
              lineHeight: 1.65,
            }}
          >
            {t('capture.deniedBody')}
          </div>
          <button type="button" onClick={onFallback} style={{ ...primaryBtn, marginTop: 16 }}>
            {t('capture.pickFromDisk')}
          </button>
        </div>
      )}

      {state === 'live' && (
        <div style={{ ...cardStyle, padding: 18 }}>
          <div
            style={{
              position: 'relative',
              borderRadius: 16,
              overflow: 'hidden',
              background: '#241C1F',
            }}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              aria-label={t('capture.streamAria')}
              style={{ display: 'block', width: '100%', maxHeight: 460, objectFit: 'contain' }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 22,
              marginTop: 16,
            }}
          >
            <button type="button" onClick={onFallback} style={squareBtn} title={t('capture.pickFromDisk')}>
              📁
            </button>
            <button
              type="button"
              onClick={shoot}
              aria-label={t('capture.shoot')}
              data-testid="capture-shutter"
              style={{
                width: 66,
                height: 66,
                borderRadius: '50%',
                border: '4px solid var(--color-surface)',
                background: 'var(--color-primary)',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-card)',
              }}
            />
          </div>
        </div>
      )}

      {state === 'review' && shot && (
        <div style={{ ...cardStyle, padding: 18 }}>
          <img
            src={shot.url}
            alt={t('capture.previewAlt')}
            style={{
              display: 'block',
              width: '100%',
              maxHeight: 460,
              objectFit: 'contain',
              borderRadius: 16,
              background: 'var(--color-surface-muted)',
            }}
          />
          <div style={{ display: 'flex', gap: 9, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => onCapture(shot.file)}
              data-testid="capture-use"
              style={{ ...primaryBtn, flex: 1, minWidth: 150 }}
            >
              {t('capture.use')}
            </button>
            <button
              type="button"
              onClick={retake}
              style={{ ...outlineBtn, flex: 1, minWidth: 150 }}
            >
              {t('capture.retake')}
            </button>
          </div>
          <div style={noteStyle}>{t('capture.reviewNote')}</div>
        </div>
      )}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg
      width={34}
      height={34}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ color: 'var(--color-primary-strong)' }}
    >
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
    </svg>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 20,
  color: 'var(--color-foreground)',
};

const noteStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: 'var(--color-muted)',
  lineHeight: 1.6,
  marginTop: 12,
};

const backLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 13.5,
  color: 'var(--color-muted)',
  fontWeight: 600,
  padding: 0,
  marginBottom: 14,
  fontFamily: 'inherit',
};

const primaryBtn: React.CSSProperties = {
  padding: '11px 20px',
  borderRadius: 999,
  border: 'none',
  background: 'var(--color-primary)',
  color: 'var(--color-primary-foreground)',
  fontWeight: 700,
  fontSize: 13.5,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const outlineBtn: React.CSSProperties = {
  padding: '11px 20px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-foreground)',
  fontWeight: 600,
  fontSize: 13.5,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const squareBtn: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 14,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-foreground)',
  cursor: 'pointer',
  fontSize: 16,
};
