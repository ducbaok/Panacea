'use client';

import type { ReactNode } from 'react';

/**
 * REVIEW-1 (#4) — Header của MỘT cột trong màn Tin nhắn.
 *
 * Vì sao phải có component này thay vì hai khối style rời:
 *   Người dùng báo "đường nét bị lệch" ở màn tin nhắn (18/08/2026). Đo ra: hai
 *   header của hai cột cao khác nhau ~5px — cột trái `padding:16 / fontSize:15`,
 *   cột phải `padding:'14px 18px' / fontSize:14.5` — nên hai vạch `borderBottom`
 *   nằm ở hai độ cao khác nhau và đường ngang GÃY KHÚC đúng tại vạch dọc ngăn
 *   hai cột.
 *
 *   Cặp số lệch đó được chép **byte-đúng từ bản vẽ** (`Panacea-v2.1.html` tự
 *   lệch), nên đây không phải lỗi người code. Nhưng nó sẽ quay lại sau mỗi lần
 *   ai đó chỉnh một bên: hai con số sống ở hai file, không có gì buộc chúng
 *   bằng nhau. Gom về một chỗ là cách duy nhất đóng hẳn.
 *
 * Chuẩn hoá theo CỘT PHẢI (`padding:'14px 18px'`, `fontSize:14.5`) vì composer
 * ở đáy cột phải cũng dùng đúng `padding:'14px 18px'` ⇒ header và composer cân
 * nhau trong cùng một cột.
 *
 * `flex: 'none'`: header KHÔNG được co lại và KHÔNG được cuộn theo danh sách —
 * bệnh thứ hai của cùng màn này (xem `messages-view.tsx`).
 */
export function PaneHeader({
  children,
  ariaHidden,
}: {
  children: ReactNode;
  /** true cho header giữ-chỗ (nhánh chưa chọn hội thoại) — không đọc lên. */
  ariaHidden?: boolean;
}) {
  return (
    <div
      aria-hidden={ariaHidden}
      data-testid="pane-header"
      style={{
        flex: 'none',
        padding: '14px 18px',
        fontWeight: 700,
        fontSize: 14.5,
        borderBottom: '1px solid var(--color-border)',
        color: 'var(--color-foreground)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {children}
    </div>
  );
}
