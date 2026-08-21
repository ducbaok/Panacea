'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PinDetail } from '@/components/pin/pin-detail';

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

export function PinModal({ id }: { id: string }) {
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
   */
  useEffect(() => {
    if (id === 'new' && typeof window !== 'undefined') {
      window.location.replace('/pin/new');
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
        aria-label="Chi tiết pin"
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
            aria-label="Đóng"
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
      aria-label="Chi tiết pin"
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
