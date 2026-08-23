'use client';

import { useState } from 'react';
import type { MessagesQuery } from '@/lib/gql/graphql';
import { useT } from '@/lib/i18n/provider';

export type MessageItem = MessagesQuery['messages']['items'][number] & {
  /** Cờ CHỈ SỐNG TRONG PHIÊN — xem ghi chú "Ba trạng thái" bên dưới. */
  revokedLocally?: boolean;
};

/**
 * Một bong bóng tin nhắn (D4). Số đo chép từ bundle `Panacea-v2.1.html`
 * (view `messages`, `MESSAGES.map`):
 *   hàng      display:flex; justify-content: flex-end (mình) | flex-start
 *   bong bóng max-width 72%; radius 18; nền primary (mình) | surface + border
 *   chữ       13.5px / line-height 1.5
 *   thẻ pin   rộng 150; radius 12; thumb cao 110; tiêu đề 12.5px/600, đệm 8/10
 *   đệm       10px 14px cho tin chữ · 6px cho tin chỉ-pin
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  BA TRẠNG THÁI RIÊNG — vì sao mỗi cái được dựng như hiện tại              ║
 * ║                                                                          ║
 * ║  1. TIN CHỈ-PIN. `Message.content` nullable còn `attachedPinId` có giá    ║
 * ║     trị ⇒ tin hợp lệ mà KHÔNG có chữ (đo bằng request thật: sendMessage   ║
 * ║     chỉ với attachedPinId trả content=null + attachedPin đầy đủ). Render  ║
 * ║     thẻ pin, KHÔNG render bong bóng rỗng — đúng bản vẽ (`textStyle` bị    ║
 * ║     `display:none` khi `type === "pin"`). Tin có CẢ chữ lẫn pin thì hiện  ║
 * ║     cả hai; bản vẽ không có mẫu đó nên xếp chữ trên, thẻ dưới.            ║
 * ║                                                                          ║
 * ║  2. TIN ĐÃ THU HỒI. ⚠️ Đây KHÔNG phải `deletedAt` đọc từ server. Query    ║
 * ║     `messages` lọc sẵn `deletedAt: null` (messages.service.ts) nên tin    ║
 * ║     thu hồi BIẾN MẤT khỏi danh sách — `deletedAt` trả về luôn null, đo    ║
 * ║     được 17/08. Hướng đã chốt với user: giữ bong bóng "đã thu hồi" bằng   ║
 * ║     cờ `revokedLocally` trong cache của PHIÊN ĐANG MỞ; F5 là mất hẳn.     ║
 * ║     Vì thế biến ở đây tên `revokedLocally`, không phải `deleted` — đọc    ║
 * ║     tên là biết nó không bền.                                            ║
 * ║                                                                          ║
 * ║  3. (trạng thái thứ ba — bị từ chối lúc subscribe — nằm ở chat-panel,     ║
 * ║     không phải ở bong bóng.)                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function MessageBubble({
  m,
  mine,
  onRevoke,
}: {
  m: MessageItem;
  mine: boolean;
  onRevoke?: () => void;
}) {
  const t = useT();
  const [hover, setHover] = useState(false);
  const revoked = !!m.revokedLocally;
  const pin = revoked ? null : m.attachedPin;
  const text = revoked ? t('messages.revoked') : m.content;
  const pinOnly = !!pin && !text;

  return (
    <div
      style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'center', gap: 6 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Nút ⋯ nằm TRƯỚC bong bóng của mình (bong bóng dạt phải) nên nó rơi vào
          phía trong, không tràn mép khung. Bản vẽ không vẽ nút này — hình dạng
          ⋯-khi-rê-chuột do user chốt 17/08, dùng lại khuôn menu ⋯ của C1b/C4. */}
      {mine && !revoked && onRevoke && (
        <button
          type="button"
          onClick={onRevoke}
          aria-label={t('messages.revoke')}
          title={t('messages.revoke')}
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: 'var(--color-muted)',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            flex: 'none',
            // Mờ khi không rê chuột, rõ khi rê — KHÔNG dùng `visibility:hidden`.
            //
            // Bản đầu viết `visibility: hover ? 'visible' : 'hidden'` và nút
            // THÀNH RA KHÔNG BẤM ĐƯỢC: phần tử `visibility:hidden` không nhận
            // sự kiện chuột, mà lần rê đầu tiên và cú bấm rơi vào cùng một nhịp
            // nên React chưa kịp vẽ lại — bấm xuyên qua, hộp xác nhận không mở.
            // Đo được trên trình duyệt thật 17/08.
            //
            // Nặng hơn: máy cảm ứng KHÔNG có trạng thái hover, nên nút ẩn theo
            // hover là nút KHÔNG BAO GIỜ chạm tới được. Giữ nút luôn hiện (mờ)
            // là cách duy nhất vừa đúng ý "rê chuột mới nổi bật" vừa không khoá
            // hẳn tính năng trên điện thoại.
            opacity: hover ? 1 : 0.35,
            transition: 'opacity 120ms ease',
          }}
        >
          ⋯
        </button>
      )}

      <div
        style={{
          maxWidth: '72%',
          borderRadius: 18,
          overflow: 'hidden',
          background: mine ? 'var(--color-primary)' : 'var(--color-surface)',
          border: mine ? '1px solid transparent' : '1px solid var(--color-border)',
          color: mine ? 'var(--color-primary-foreground)' : 'var(--color-foreground)',
          padding: pinOnly ? 6 : '10px 14px',
        }}
      >
        {text && (
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              ...(revoked ? { opacity: 0.5, fontStyle: 'italic' } : null),
            }}
          >
            {text}
          </div>
        )}

        {pin && (
          <div
            style={{
              width: 150,
              borderRadius: 12,
              overflow: 'hidden',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              marginTop: text ? 8 : 0,
            }}
          >
            {/* 3 URL ảnh responsive đều nullable và ở dev thường null hết
                ⇒ LUÔN fallback về imageUrl (bẫy §4.3). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pin.thumbnailUrl ?? pin.imageUrl}
              alt={pin.title ?? ''}
              style={{ display: 'block', width: '100%', height: 110, objectFit: 'cover' }}
            />
            <div style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 10px' }}>{pin.title ?? ''}</div>
          </div>
        )}
      </div>
    </div>
  );
}
