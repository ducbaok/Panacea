'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useT } from '@/lib/i18n/provider';
import type { TFunction } from '@/lib/i18n';
import { normalizeMime } from '@/lib/upload';

/**
 * XH-CAM — CHỤP ẢNH + QUAY VIDEO NGẮN bằng `getUserMedia` (bản vẽ
 * `Panacea-v3.1.html`, spec `docs/spec-man-xahoi-capture.md`).
 *
 * Phần video lên sóng 26/08/2026 theo **phương án A**: không transcode ở server.
 * `MediaRecorder` ghi thẳng ở client, hẹn giờ dừng cứng theo mốc, rồi upload
 * nguyên bản. Server chỉ nới whitelist MIME + trần 30MB.
 *
 * Bảy trạng thái, khớp mục 1/2/3/6/7/8/9 của spec:
 *   prompt    — chưa xin quyền, kèm đường lui "Chọn ảnh từ máy"
 *   denied    — người dùng/trình duyệt từ chối, kèm cách bật lại
 *   live      — khung ngắm + nút chụp (hoặc nút quay, tuỳ toggle Ảnh/Video)
 *   review    — xem lại ảnh: "Dùng ảnh này" / "Chụp lại"        (Q2 = CÓ, QĐ-27)
 *   recording — đang quay: đồng hồ + vòng tiến trình + dừng sớm
 *   vreview   — xem lại video: phát lại + thanh chọn poster      (Q5)
 * Trạng thái xử lý/upload KHÔNG ở màn này: kết quả trả về màn tạo pin và đi
 * CHUNG một tiến trình với ảnh chọn từ đĩa — spec §3 cấm luồng đăng thứ hai.
 *
 * ⚠️ `getUserMedia` chỉ tồn tại trên HTTPS hoặc localhost. `isSecureContext`
 * sai ⇒ hiện thẳng lý do chứ không để nút chụp im lặng không làm gì.
 *
 * ⚠️ Ảnh do canvas sinh KHÔNG có thẻ EXIF (canvas vẽ pixel đã đúng chiều), nên
 * đường chụp không dính bẫy orientation — `lib/image/resize.ts` xử lý cả hai
 * đường bằng cùng một hàm mà không cần nhánh riêng.
 *
 * ═══ BỐN QUYẾT ĐỊNH CỦA PHẦN VIDEO ═══════════════════════════════════════
 *
 * 1. **Poster lấy TRONG LÚC QUAY, không seek lại sau.** Đây là điểm dễ làm sai
 *    nhất. File webm do `MediaRecorder` sinh ra thường KHÔNG có metadata thời
 *    lượng (`video.duration === Infinity`), nên cách "tự nhiên" — nạp lại đoạn
 *    vừa quay rồi `currentTime = t` để bốc frame — seek trượt hoặc trả frame
 *    đen, tuỳ trình duyệt. Chụp từ thẻ `<video>` ĐANG phát luồng camera thì
 *    không có metadata nào để mà hỏng, và frame lấy được đúng bằng thứ người
 *    dùng vừa nhìn thấy. Frame đầu chụp ngay lúc bấm quay = mặc định của Q5.
 *
 * 2. **Micro là tuỳ chọn, không phải điều kiện.** Chế độ video xin `audio:true`,
 *    nhưng nếu bị từ chối thì mở lại luồng chỉ có hình thay vì rơi vào màn
 *    "bị chặn". Mất tiếng vẫn quay được; hỏng cả khâu quay vì thiếu micro thì
 *    không. Chế độ ảnh KHÔNG xin micro — xin quyền không dùng tới là lạm dụng.
 *
 * 3. **Hẹn giờ dừng đọc `performance.now()`, không đếm số lần tick.** Tab chạy
 *    nền bị trình duyệt bóp `setInterval` xuống 1 lần/giây; đếm tick thì một
 *    đoạn "15 giây" thành 40 giây thật và vượt cả trần 30MB. Mốc là thời gian
 *    THẬT trôi qua.
 *
 * 4. **Đổi Ảnh ⇄ Video lúc đang ngắm thì MỞ LẠI luồng.** Ràng buộc `audio`
 *    chốt lúc `getUserMedia`, không đổi được trên luồng đang chạy.
 */

type CamState = 'prompt' | 'denied' | 'live' | 'review' | 'recording' | 'vreview';
type CamKind = 'photo' | 'video';

/** Mốc thời lượng — Q4: chọn TRƯỚC khi quay, ngay trong khung ngắm. */
const DURATIONS = [10, 15, 30] as const;
type DurationSec = (typeof DURATIONS)[number];

/** Số frame bốc ra làm ứng viên poster (Q5). Frame 0 = mặc định. */
const POSTER_FRAMES = 5;

/**
 * Bitrate ép ~3 Mbps (spec: 2,5–4) ⇒ 30s ≈ 11MB, nằm gọn dưới trần 30MB.
 * Không để `MediaRecorder` tự chọn: mặc định của Chrome bám theo độ phân giải
 * camera, và một webcam 1080p sẽ vượt trần ở đúng mốc 30s.
 */
const VIDEO_BITS_PER_SECOND = 3_000_000;
const AUDIO_BITS_PER_SECOND = 128_000;

/** Nhịp đồng hồ. 100ms đủ mượt cho vòng tiến trình mà không tốn gì. */
const TICK_MS = 100;

/**
 * Ứng viên container, thử theo thứ tự. Chrome/Firefox đáp ở một trong ba dòng
 * webm; Safari chỉ đáp `video/mp4`. Không dòng nào được ⇒ toggle Video mờ kèm
 * giải thích (spec mục 10) chứ không ẩn — cùng tinh thần với nút chụp lúc máy
 * không có camera.
 */
const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

/**
 * Container quay được của MÁY NÀY — `null` nghĩa là không quay được.
 *
 * Đọc bằng `useSyncExternalStore` chứ không phải `useState` + `useEffect`, và
 * cũng không phải lazy initializer:
 *   · lazy initializer chạy cả trên server, nơi `MediaRecorder` không tồn tại
 *     ⇒ server dựng nút Video mờ còn client dựng nút sáng ⇒ lệch hydration;
 *   · `useState(null)` rồi `setVideoMime(...)` ngay trong thân effect là đúng
 *     thứ `react-hooks/set-state-in-effect` cấm, và cấm có lý: nó ép thêm một
 *     vòng render cho một giá trị vốn không bao giờ đổi.
 * `useSyncExternalStore` diễn đạt đúng bản chất: một giá trị chỉ có ở client,
 * server có ảnh chụp riêng (`null`), và React tự nối hai bên khi hydrate.
 *
 * Khả năng của trình duyệt không đổi giữa chừng ⇒ `subscribe` không đăng ký gì.
 * Kết quả nhớ ở biến module: `getSnapshot` bị gọi mỗi lần render, mà
 * `isTypeSupported` không rẻ đến mức chạy bốn lần cho mỗi lần vẽ lại.
 */
let cachedVideoMime: string | null | undefined;

function getVideoMime(): string | null {
  if (cachedVideoMime === undefined) {
    cachedVideoMime =
      typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined'
        ? null
        : (VIDEO_MIME_CANDIDATES.find((m) =>
            // `isTypeSupported` thiếu ở vài bản Safari cũ — thiếu thì coi như không.
            typeof MediaRecorder.isTypeSupported === 'function'
              ? MediaRecorder.isTypeSupported(m)
              : false,
          ) ?? null);
  }
  return cachedVideoMime;
}

const subscribeNever = () => () => {};
const getServerVideoMime = () => null;

type Shot = { url: string; file: File };
type VideoShot = Shot & { durationMs: number };

type Props = {
  /** Ảnh người dùng chấp nhận — màn tạo pin nhận và chạy tiếp pipeline chung. */
  onCapture: (file: File) => void;
  /**
   * Video người dùng chấp nhận, kèm POSTER đã chọn và thời lượng thật.
   * Poster đi qua đúng pipeline ảnh, nên màn tạo pin không có nhánh thứ hai.
   */
  onCaptureVideo: (video: File, poster: File, durationMs: number) => void;
  /** "Chọn ảnh từ máy" / "Quay lại tạo pin" — đường lui về ô chọn file. */
  onFallback: () => void;
};

export function CaptureView({ onCapture, onCaptureVideo, onFallback }: Props) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CamState>('prompt');
  const [kind, setKind] = useState<CamKind>('photo');
  const [shot, setShot] = useState<Shot | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // ── Riêng phần quay ───────────────────────────────────────────────────────
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const nextFrameAtRef = useRef(0);
  /** Số frame poster đã bốc — ref chứ không state, xem chú thích ở vòng tick. */
  const framesTakenRef = useRef(0);
  const [durationSec, setDurationSec] = useState<DurationSec>(15);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [videoShot, setVideoShot] = useState<VideoShot | null>(null);
  const [posters, setPosters] = useState<Shot[]>([]);
  const [posterIndex, setPosterIndex] = useState(0);
  const [micDenied, setMicDenied] = useState(false);
  /** `null` = trình duyệt này không quay được — xem `getVideoMime`. */
  const videoMime = useSyncExternalStore(
    subscribeNever,
    getVideoMime,
    getServerVideoMime,
  );

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
  const videoUnavailable = cameraUnavailable || videoMime === null;

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

  const clearTick = useCallback(() => {
    if (tickRef.current != null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    // Dừng recorder TRƯỚC khi tắt track: `MediaRecorder` đang chạy trên một
    // stream đã chết sẽ ném `InvalidStateError` ở lần `stop()` kế tiếp.
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        // Đóng máy thì mọi lỗi ở đây đều vô hại.
      }
    }
    recorderRef.current = null;
    clearTick();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [clearTick]);

  // Tắt camera khi rời màn. Thiếu bước này là đèn camera sáng mãi sau khi người
  // dùng đã quay về form — vừa là lỗi riêng tư, vừa giữ thiết bị cho tab khác.
  useEffect(() => stopStream, [stopStream]);

  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  useEffect(() => {
    return () => {
      if (videoShot) URL.revokeObjectURL(videoShot.url);
    };
  }, [videoShot]);

  useEffect(() => {
    return () => {
      posters.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [posters]);

  /**
   * Mở luồng camera. `wantAudio` chỉ đúng ở chế độ video — xem quyết định 2.
   * Trả về true nếu mở được.
   */
  const openStream = useCallback(async (wantAudio: boolean): Promise<boolean> => {
    const constraints: MediaStreamConstraints = {
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: wantAudio,
    };
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
      setMicDenied(false);
      return true;
    } catch (err) {
      const name = (err as { name?: string })?.name ?? '';
      if (wantAudio) {
        // Không phân biệt được camera hay micro bị chặn, nên thử lại KHÔNG có
        // micro. Mở được ⇒ đúng là micro bị chặn: quay tiếp, chỉ mất tiếng.
        try {
          streamRef.current = await navigator.mediaDevices.getUserMedia({
            ...constraints,
            audio: false,
          });
          setMicDenied(true);
          return true;
        } catch {
          // Rơi xuống nhánh lỗi chung bên dưới.
        }
      }
      if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied');
      else setStartError(t('capture.startFailed'));
      return false;
    }
  }, [t]);

  const start = useCallback(
    async (nextKind: CamKind) => {
      setStartError(null);
      if (cameraUnavailable) return;
      if (nextKind === 'video' && videoUnavailable) return;
      stopStream();
      const ok = await openStream(nextKind === 'video');
      if (!ok) return;
      setKind(nextKind);
      setState('live');
      // Gán sau khi state đổi để phần tử <video> đã có trong DOM.
      window.setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          void videoRef.current.play().catch(() => undefined);
        }
      }, 0);
    },
    [cameraUnavailable, openStream, stopStream, videoUnavailable],
  );

  /** Vẽ frame hiện tại của khung ngắm ra canvas. Dùng cho cả chụp lẫn poster. */
  const grabFrame = useCallback((filename: string): Promise<Shot | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return resolve(null);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(null);
          const file = new File([blob], filename, { type: 'image/jpeg' });
          resolve({ url: URL.createObjectURL(file), file });
        },
        'image/jpeg',
        0.92,
      );
    });
  }, []);

  const shoot = () => {
    void grabFrame('capture.jpg').then((taken) => {
      if (!taken) return;
      const video = videoRef.current;
      const named = new File(
        [taken.file],
        `capture-${video?.videoWidth ?? 0}x${video?.videoHeight ?? 0}.jpg`,
        { type: 'image/jpeg' },
      );
      setShot({ url: taken.url, file: named });
      setState('review');
      stopStream();
    });
  };

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    void start('photo');
  };

  // ── Quay ──────────────────────────────────────────────────────────────────

  const finishRecording = useCallback(
    (durationMs: number) => {
      clearTick();
      const mime = normalizeMime(recorderRef.current?.mimeType ?? videoMime ?? 'video/webm');
      const blob = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];
      const ext = mime === 'video/mp4' ? 'mp4' : 'webm';
      // Tên file mang thời lượng thay vì dấu thời gian: `Date.now()` trong cây
      // React là thứ dự án đang mắc nợ lint ở chỗ khác, không thêm chỗ mới.
      const file = new File([blob], `capture-${Math.round(durationMs)}ms.${ext}`, {
        type: mime,
      });
      setVideoShot({ url: URL.createObjectURL(file), file, durationMs });
      setPosterIndex(0);
      setState('vreview');
      stopStream();
    },
    [clearTick, stopStream, videoMime],
  );

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return;
    clearTick();
    // Thời lượng chốt Ở ĐÂY chứ không trong `onstop`: `onstop` chạy trễ sau khi
    // trình duyệt gom nốt chunk cuối, và cái trễ đó đi thẳng vào con số hiện ra
    // cho người dùng.
    const durationMs = performance.now() - startedAtRef.current;
    rec.onstop = () => finishRecording(durationMs);
    try {
      rec.stop();
    } catch {
      finishRecording(durationMs);
    }
  }, [clearTick, finishRecording]);

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || !videoMime || state !== 'live') return;
    const limitMs = durationSec * 1000;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, {
        mimeType: videoMime,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch {
      setStartError(t('capture.recordFailed'));
      return;
    }
    recorderRef.current = rec;
    chunksRef.current = [];
    posters.forEach((p) => URL.revokeObjectURL(p.url));
    setPosters([]);
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.start();
    startedAtRef.current = performance.now();
    nextFrameAtRef.current = limitMs / POSTER_FRAMES;
    setElapsedMs(0);
    setState('recording');
    // Frame đầu = mặc định của Q5, bốc ngay tại thời điểm bấm quay.
    framesTakenRef.current = 1;
    void grabFrame('poster-0.jpg').then((p) => {
      if (p) setPosters((prev) => [...prev, p]);
    });

    tickRef.current = window.setInterval(() => {
      // Thời gian THẬT, không đếm tick — xem quyết định 3.
      const elapsed = performance.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      // Đếm bằng REF, không đọc `posters.length`: callback này đóng băng giá trị
      // state tại lúc `setInterval` chạy (luôn là 0), nên điều kiện dựa trên
      // state ở đây không bao giờ đúng với thực tế.
      if (elapsed >= nextFrameAtRef.current && framesTakenRef.current < POSTER_FRAMES) {
        const index = framesTakenRef.current;
        framesTakenRef.current += 1;
        nextFrameAtRef.current += limitMs / POSTER_FRAMES;
        void grabFrame(`poster-${index}.jpg`).then((p) => {
          if (p) setPosters((prev) => (prev.length < POSTER_FRAMES ? [...prev, p] : prev));
        });
      }
      if (elapsed >= limitMs) stopRecording();
    }, TICK_MS);
  };

  const retakeVideo = () => {
    if (videoShot) URL.revokeObjectURL(videoShot.url);
    posters.forEach((p) => URL.revokeObjectURL(p.url));
    setVideoShot(null);
    setPosters([]);
    void start('video');
  };

  const useVideo = () => {
    const poster = posters[posterIndex] ?? posters[0];
    if (!videoShot || !poster) return;
    onCaptureVideo(videoShot.file, poster.file, videoShot.durationMs);
  };

  const limitMs = durationSec * 1000;
  const progress = Math.min(1, elapsedMs / limitMs);

  return (
    <div data-screen="XH-CAM" data-state={state} data-kind={kind} style={{ maxWidth: 560 }}>
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
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <ModeToggle
              kind={kind}
              onChange={setKind}
              videoDisabled={videoUnavailable}
              t={t}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 9,
              justifyContent: 'center',
              marginTop: 16,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => void start(kind)}
              disabled={kind === 'video' ? videoUnavailable : cameraUnavailable}
              data-testid="capture-allow"
              style={{
                ...primaryBtn,
                opacity: (kind === 'video' ? videoUnavailable : cameraUnavailable) ? 0.5 : 1,
                cursor:
                  (kind === 'video' ? videoUnavailable : cameraUnavailable)
                    ? 'not-allowed'
                    : 'pointer',
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
          {!cameraUnavailable && videoMime === null && (
            <div data-testid="capture-norec" style={noteStyle}>
              {t('capture.noRecorderNote')}
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

      {(state === 'live' || state === 'recording') && (
        <div style={{ ...cardStyle, padding: 18 }}>
          {state === 'live' && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <ModeToggle
                kind={kind}
                onChange={(next) => void start(next)}
                videoDisabled={videoUnavailable}
                t={t}
              />
            </div>
          )}
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
            {state === 'recording' && (
              <div data-testid="capture-clock" style={clockStyle}>
                <span style={{ color: 'var(--color-danger)', fontSize: 16 }}>●</span>
                {formatClock(elapsedMs)} / {formatClock(limitMs)}
              </div>
            )}
          </div>

          {state === 'live' && kind === 'video' && (
            <div
              role="group"
              aria-label={t('capture.durationAria')}
              style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 14 }}
            >
              {DURATIONS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setDurationSec(sec)}
                  aria-pressed={durationSec === sec}
                  data-testid={`capture-duration-${sec}`}
                  style={{
                    ...segmentBtn,
                    background:
                      durationSec === sec ? 'var(--color-primary)' : 'var(--color-surface)',
                    color:
                      durationSec === sec
                        ? 'var(--color-primary-foreground)'
                        : 'var(--color-foreground)',
                    borderColor:
                      durationSec === sec ? 'var(--color-primary)' : 'var(--color-border)',
                  }}
                >
                  {t('capture.durationSec', { seconds: sec })}
                </button>
              ))}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 22,
              marginTop: 16,
            }}
          >
            {state === 'live' && (
              <button
                type="button"
                onClick={onFallback}
                style={squareBtn}
                title={t('capture.pickFromDisk')}
              >
                📁
              </button>
            )}
            {state === 'live' && kind === 'photo' && (
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
            )}
            {state === 'live' && kind === 'video' && (
              <button
                type="button"
                onClick={startRecording}
                aria-label={t('capture.record')}
                data-testid="capture-record"
                style={{
                  width: 66,
                  height: 66,
                  borderRadius: '50%',
                  border: '4px solid var(--color-surface)',
                  background: 'var(--color-danger)',
                  cursor: 'pointer',
                  boxShadow: 'var(--shadow-card)',
                }}
              />
            )}
            {state === 'recording' && (
              <ProgressRing progress={progress}>
                <button
                  type="button"
                  onClick={stopRecording}
                  aria-label={t('capture.stop')}
                  data-testid="capture-stop"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: 'none',
                    background: 'var(--color-danger)',
                    cursor: 'pointer',
                  }}
                />
              </ProgressRing>
            )}
          </div>

          {state === 'live' && kind === 'video' && micDenied && (
            <div data-testid="capture-nomic" style={noteStyle}>
              {t('capture.noMicNote')}
            </div>
          )}
          {startError && (
            <div role="alert" style={{ ...noteStyle, color: 'var(--color-danger)' }}>
              {startError}
            </div>
          )}
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

      {state === 'vreview' && videoShot && (
        <div style={{ ...cardStyle, padding: 18 }}>
          <video
            src={videoShot.url}
            controls
            playsInline
            data-testid="capture-video-preview"
            aria-label={t('capture.videoPreviewAria')}
            style={{
              display: 'block',
              width: '100%',
              maxHeight: 460,
              borderRadius: 16,
              background: 'var(--color-surface-muted)',
            }}
          />

          {posters.length > 0 && (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 14 }}>
                {t('capture.posterTitle')}
              </div>
              <div
                role="group"
                aria-label={t('capture.posterTitle')}
                style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}
              >
                {posters.map((p, i) => (
                  <button
                    key={p.url}
                    type="button"
                    onClick={() => setPosterIndex(i)}
                    aria-pressed={posterIndex === i}
                    data-testid={`capture-poster-${i}`}
                    style={{
                      padding: 0,
                      borderRadius: 10,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      background: 'none',
                      border:
                        posterIndex === i
                          ? '3px solid var(--color-primary)'
                          : '3px solid transparent',
                      lineHeight: 0,
                    }}
                  >
                    <img
                      src={p.url}
                      alt={t('capture.posterFrameAlt', { index: i + 1 })}
                      style={{ width: 76, height: 54, objectFit: 'cover', display: 'block' }}
                    />
                  </button>
                ))}
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 9, marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={useVideo}
              disabled={posters.length === 0}
              data-testid="capture-video-use"
              style={{
                ...primaryBtn,
                flex: 1,
                minWidth: 150,
                opacity: posters.length === 0 ? 0.5 : 1,
                cursor: posters.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {t('capture.useVideo')}
            </button>
            <button
              type="button"
              onClick={retakeVideo}
              style={{ ...outlineBtn, flex: 1, minWidth: 150 }}
            >
              {t('capture.retakeVideo')}
            </button>
          </div>
          <div style={noteStyle}>
            {posters.length === 0
              ? t('capture.posterMissingNote')
              : t('capture.videoReviewNote', { seconds: Math.round(videoShot.durationMs / 1000) })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Toggle Ảnh/Video — bản vẽ có sẵn, giờ mới dựng thật.
 *
 * Không quay được thì nút Video **MỜ chứ không ẩn** (spec mục 10, cùng tinh
 * thần với nút chụp lúc máy không camera): ẩn đi thì người dùng tưởng sản phẩm
 * không có tính năng, mờ kèm giải thích thì họ biết là máy mình không hợp.
 */
function ModeToggle({
  kind,
  onChange,
  videoDisabled,
  t,
}: {
  kind: CamKind;
  onChange: (next: CamKind) => void;
  videoDisabled: boolean;
  t: TFunction;
}) {
  const item = (value: CamKind, label: string, disabled: boolean) => (
    <button
      type="button"
      onClick={() => !disabled && onChange(value)}
      disabled={disabled}
      aria-pressed={kind === value}
      data-testid={`capture-mode-${value}`}
      style={{
        ...segmentBtn,
        minWidth: 84,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: kind === value ? 'var(--color-primary)' : 'var(--color-surface)',
        color:
          kind === value ? 'var(--color-primary-foreground)' : 'var(--color-foreground)',
        borderColor: kind === value ? 'var(--color-primary)' : 'var(--color-border)',
      }}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label={t('capture.modeAria')} style={{ display: 'flex', gap: 6 }}>
      {item('photo', t('capture.modePhoto'), false)}
      {item('video', t('capture.modeVideo'), videoDisabled)}
    </div>
  );
}

/**
 * Vòng tiến trình quanh nút dừng (spec mục 8).
 *
 * `strokeDasharray`/`strokeDashoffset` chứ không phải một thanh ngang: bản vẽ
 * vẽ vòng, và vòng nói được "còn bao nhiêu" mà không cần đọc số — người đang
 * quay thì đang nhìn khung ngắm chứ không nhìn đồng hồ.
 */
function ProgressRing({
  progress,
  children,
}: {
  progress: number;
  children: React.ReactNode;
}) {
  const size = 66;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg
        width={size}
        height={size}
        aria-hidden
        style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-danger)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** `m:ss` — thời lượng tối đa là 30s nên không cần nhánh giờ. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
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

const clockStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  fontSize: 12.5,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
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

const segmentBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  fontWeight: 700,
  fontSize: 12.5,
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
