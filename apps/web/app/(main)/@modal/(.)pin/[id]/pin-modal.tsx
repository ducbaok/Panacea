'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PinDetail } from '@/components/pin/pin-detail';
import { useT } from '@/lib/i18n/provider';

/**
 * FE-4 — Wrapper modal cho intercepting route `@modal/(.)pin/[id]`.
 *
 * Ba đường đóng, cả ba cùng gọi một hàm (§5.3 PROMPT_FE4.md):
 *   • Nút × trong header của PinDetail (variant='modal' truyền onClose)
 *   • Phím ESC
 *   • Bấm NỀN (overlay). `stopPropagation` trên khung để bấm trong khung
 *     KHÔNG đóng — mockup Panacea làm đúng chỗ này.
 *
 * router.back() — KHÔNG router.push('/'). Modal chỉ đến được bằng soft
 * navigation từ lưới, nên luôn có trang trước để lùi về. `back()` giữ đúng
 * vị trí cuộn; `push` chồng thêm history entry và làm nút Back trình duyệt
 * nhảy sai.
 *
 * Khoá cuộn nền khi modal mở (§5.5). TRẢ LẠI ĐÚNG giá trị cũ khi đóng, không
 * hardcode `''` — nếu người dùng đã đặt `overflow` tuỳ chỉnh trước đó, hardcode
 * `''` xoá cả setting của họ.
 *
 * ⚠️ QĐ-2b — hướng A đã chốt (§5.4): intercepting route LUÔN chặn soft-nav
 * bất kể bề rộng viewport, nên KHÔNG có công tắc router để tắt theo màn hình.
 * Component tự đổi HÌNH dưới 768px: bỏ nền mờ + chiếm trọn màn + render
 * variant='page' — thoả tinh thần "mobile thấy trang đầy đủ" mà không phải
 * hard-navigation (giữ vị trí cuộn của lưới).
 */

const MOBILE_BREAKPOINT = 768;

/**
 * 🔴 Cửa chặn URL — slot `@modal` KHÔNG tự tắt khi rời route pin (sửa 26/08/2026).
 *
 * Next.js chỉ dùng `@modal/default.tsx` cho điều hướng CỨNG. Với soft-nav,
 * slot nào không khớp route mới thì giữ nguyên nội dung đang render — nên bấm
 * tên tác giả trong modal đi tới `/@username`: trang hồ sơ nạp đúng ở dưới,
 * còn modal pin vẫn nằm đè lên trên. Tệ hơn, ESC lúc đó gọi `router.back()`,
 * mà bước lùi bây giờ là rời hồ sơ về `/pin/<id>` ⇒ người dùng thấy "bấm ESC
 * lại nhảy về trang chủ" thay vì "đóng bài đăng". Đo được trên trình duyệt sau
 * khi `UserLink` lên sóng (26/08/2026).
 *
 * Luật đúng chỉ có một câu: modal chỉ được hiện khi URL ĐANG là `/pin/<id>`.
 * `usePathname()` là nguồn sự thật duy nhất cho việc đó — không cần bắt tay
 * với `UserLink` hay bất kỳ liên kết nào khác, nên mọi lối rời trang mai sau
 * (nút, `router.push`, liên kết mới) đều tự động đúng.
 *
 * ⚠️ Phải là hai component: bọc bằng `if` NGOÀI phần thân, không phải một
 * `return null` bên trong. Effect khoá cuộn nền (`overflow: hidden`) chỉ trả
 * lại giá trị cũ ở hàm dọn dẹp — `return null` giữ component sống, tức là nền
 * KHÔNG cuộn được nữa trong khi chẳng còn modal nào. Tách ra thì rời route =
 * unmount = cleanup chạy thật.
 */
export function PinModal({ id }: { id: string }) {
  const pathname = usePathname();
  if (pathname !== `/pin/${id}`) return null;
  return <PinModalOverlay id={id} />;
}

function PinModalOverlay({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);

  const close = useCallback(() => {
    router.back();
  }, [router]);

  /**
   * 🔴 REVIEW-1 (#3) — LƯỚI AN TOÀN cho `/pin/new`.
   *
   * Slot `@modal` resolve độc lập với cây `children`, nên MỌI soft-nav tới
   * `/pin/new` đều rơi vào `(.)pin/[id]` với `id="new"` ⇒ người dùng thấy
   * "Không tìm thấy pin này." đè lên trang cũ thay vì form tạo pin (đo được
   * trên trình duyệt 18/08/2026).
   *
   * Đường sửa chính là cờ `hardNav` ở `components/shell/nav-items.ts` (nút
   * "Tạo" dùng thẻ `<a>` thường). Effect này là lưới thứ hai: nếu sau này có
   * đường vào mới quên đặt cờ, nó tự chuyển sang điều hướng cứng thay vì để
   * người dùng nhìn thông báo sai. `replace` chứ không `assign` — không để
   * lại một history entry chết giữa đường lùi.
   *
   * Đặt TRƯỚC mọi effect khác và return sớm ngay dưới: modal này không bao
   * giờ được phép render cho `id === 'new'`.
   *
   * ⚠️ GIỮ NGUYÊN QUERY STRING (sửa 25/08/2026). Bản đầu `replace('/pin/new')`
   * cắt trụi phần `?…`, nên `?circle=<id>` của nút "Đăng cho vòng này" bốc hơi
   * đúng ở đây: URL đích vẫn là `/pin/new`, form vẫn mở, chỉ có khán giả chọn
   * sẵn là mất — hỏng đúng kiểu không ai nghi ngờ lưới an toàn này. Đo được
   * trên trình duyệt ngay lần thử đầu, sau khi `create-pin-view.tsx` đã đọc
   * tham số đúng và `home-view.tsx` đã gửi tham số đúng.
   */
  useEffect(() => {
    if (id === 'new' && typeof window !== 'undefined') {
      window.location.replace(`/pin/new${window.location.search}`);
    }
  }, [id]);

  // matchMedia — đọc trong effect để tránh lệch hydration.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // ESC để đóng.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Khoá cuộn nền — TRẢ LẠI ĐÚNG giá trị cũ khi đóng.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const onBackdropClick = () => close();
  const onFrameClick = (e: React.MouseEvent) => e.stopPropagation();

  // REVIEW-1 (#3) — không render gì trong lúc effect trên đang chuyển trang.
  if (id === 'new') return null;

  // Mobile: bỏ nền mờ, chiếm trọn màn, render variant='page' (hướng A §5.4).
  if (isMobile) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('pin.modalAria')}
        data-modal-mobile
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 'var(--z-modal)',
          background: 'var(--color-background)',
          overflowY: 'auto',
          padding: '16px 12px 40px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-start',
            marginBottom: 8,
          }}
        >
          <button
            type="button"
            onClick={close}
            aria-label={t('common.close')}
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <PinDetail pinId={id} variant="page" onClose={close} />
      </div>
    );
  }

  // Desktop: overlay + framed. Modal đè lưới, URL đổi thành /pin/<id>, lưới
  // vẫn còn trong DOM phía sau (T2.1).
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('pin.modalAria')}
      onClick={onBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-modal)' as unknown as number,
        background: 'var(--color-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 36,
      }}
    >
      <div
        onClick={onFrameClick}
        style={{
          width: 'min(1000px, 100%)',
          maxHeight: '100%',
        }}
      >
        <PinDetail pinId={id} variant="modal" onClose={close} />
      </div>
    </div>
  );
}
