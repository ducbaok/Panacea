'use client';

import { useState } from 'react';
import { useQuery } from '@apollo/client/react';
import {
  PinViewersDocument,
  type PinViewersQuery,
  type PinViewersQueryVariables,
  Visibility,
} from '@/lib/gql/graphql';
import { useT } from '@/lib/i18n/provider';

/**
 * XH-VIEWERS — "Ai đã xem" một pin. CHỈ trên pin KHÔNG công khai, CHỈ chính chủ.
 *
 * Bốn luật cấp sản phẩm (brief §4 — quyết định, không phải chi tiết kỹ thuật);
 * cả bốn được BACKEND thi hành, component này không lặp lại bộ lọc nào:
 *   1. chỉ ghi `PinView` cho pin không công khai ⇒ pin PUBLIC không có danh
 *      sách này. Ở đây thể hiện bằng việc KHÔNG gọi query khi `visibility` là
 *      PUBLIC — không phải để tiết kiệm request mà vì bản vẽ ghi rõ "Danh sách
 *      này chỉ có trên pin không công khai";
 *   2. khách vãng lai tính vào `viewCount` nhưng không vào danh sách;
 *   3. `viewCount` bị ẨN trên pin giới hạn — backend trả `null` cho người
 *      không phải chủ. App này chưa từng render `viewCount` ở đâu, nên không
 *      có gì phải gỡ; đừng "tiện tay" thêm số lượt xem vào màn chi tiết;
 *   4. chủ pin không tự tính lượt xem của mình.
 *
 * HAI VAI, và đây là phép hai-nhánh-trong-một-màn của đợt này:
 *   • CHỦ PIN      → thấy dòng đếm + mở được panel.
 *   • NGƯỜI TRONG VÒNG mở CÙNG pin đó → không thấy dòng đếm, không thấy lối
 *     vào panel, không thấy viewCount. Component trả `null` — không render một
 *     dòng mờ, không render placeholder. Người trong vòng không được biết rằng
 *     có một danh sách như thế tồn tại.
 *
 * XH-QĐ-15 (chốt 24/08 bằng bản vẽ, NGƯỢC đề xuất "giữ" của spec): ai bị bớt
 * khỏi vòng thì BIẾN MẤT khỏi danh sách. Luồng C lọc theo `CircleMember` hiện
 * tại; FE chỉ chép lại câu đó ở dòng ghi chú cuối panel.
 *
 * ⚠️ Bản vẽ có cột thời điểm xem bên phải mỗi hàng ("14:02 hôm nay"); ở đây
 * KHÔNG có. Không phải bỏ sót: `pinViewers` trả `[User!]!`, backend cố ý dùng
 * `firstViewedAt` để xếp thứ tự rồi bỏ đi (docblock `pinViewers` ở
 * `pins.resolver.ts` gọi việc khai thêm là "thay đổi CỘNG THÊM"). Bù lại phải
 * giữ nguyên thứ tự mảng nhận được — thứ tự CHÍNH LÀ mốc thời gian đã mất, và
 * dòng ghi chú "sắp theo lần xem đầu, mới nhất trước" nói hộ nó.
 */
export function PinViewersRow({
  pinId,
  visibility,
  isOwner,
}: {
  pinId: string;
  visibility: Visibility | null | undefined;
  isOwner: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // Non-PUBLIC + chính chủ mới có bề mặt này. `visibility == null` (nguồn dữ
  // liệu chưa chọn field) coi như PUBLIC — fail-closed, thà thiếu một dòng còn
  // hơn lộ một danh sách ra ngoài khán giả của nó.
  const eligible = isOwner && visibility != null && visibility !== Visibility.Public;

  const { data, loading, error } = useQuery<PinViewersQuery, PinViewersQueryVariables>(
    PinViewersDocument,
    { variables: { pinId }, skip: !eligible, fetchPolicy: 'cache-and-network' },
  );

  if (!eligible) return null;
  // 404 (pin của người khác / đã xoá) ⇒ im lặng biến mất, giống mọi bề mặt pin
  // khác. Một dòng báo lỗi ở đây chỉ nói với chủ pin điều họ không làm gì được.
  if (error) return null;

  const viewers = data?.pinViewers ?? [];
  const hasRows = viewers.length > 0;
  const label = loading && !data
    ? t('viewers.loading')
    : hasRows
      ? t('viewers.count', { count: viewers.length })
      : t('viewers.none');

  return (
    <div data-screen="XH-VIEWERS" data-state={hasRows ? 'list' : 'empty'}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '13px 0',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <EyeIcon />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 13.5,
            fontWeight: 700,
            color: 'var(--color-foreground)',
            fontFamily: 'inherit',
          }}
        >
          {label}
        </button>
        {/* Chép nguyên văn bản vẽ. Câu này là toàn bộ lý do dòng đếm không gây
            hiểu nhầm: chủ pin phải biết ngay rằng người trong vòng KHÔNG thấy
            nó, nếu không họ sẽ tự kiểm duyệt vì tưởng cả nhóm đang đếm nhau. */}
        <span style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
          · {t('viewers.onlyYou')}
        </span>
      </div>

      {open && (
        <div
          style={{
            marginTop: 12,
            border: '1px solid var(--color-border)',
            borderRadius: 16,
            padding: 14,
            background: 'var(--color-surface-muted)',
          }}
        >
          {hasRows ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {viewers.map((v) => (
                  <ViewerRow key={v.id} viewer={v} />
                ))}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--color-muted)',
                  lineHeight: 1.6,
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                {t('viewers.note')}
              </div>
            </>
          ) : (
            /* Trạng thái rỗng — bản vẽ gọi đây là trạng thái cảm xúc nhạy nhất
               của tính năng (spec §2). Không dùng chữ "trống rỗng", không dùng
               dấu chấm than: người vừa đăng một thứ riêng tư và chưa ai mở. */
            <div style={{ textAlign: 'center', padding: '20px 10px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-foreground)' }}>
                {t('viewers.emptyTitle')}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--color-muted)',
                  marginTop: 6,
                  lineHeight: 1.6,
                  maxWidth: 340,
                  marginLeft: 'auto',
                  marginRight: 'auto',
                }}
              >
                {t('viewers.emptyBody')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ViewerRow({
  viewer,
}: {
  viewer: PinViewersQuery['pinViewers'][number];
}) {
  const display = viewer.name || viewer.username || '';
  const handle = viewer.username ? `@${viewer.username}` : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      {viewer.avatarUrl ? (
        <img
          src={viewer.avatarUrl}
          alt=""
          style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 12.5,
            flex: 'none',
          }}
        >
          {(display || '?').trim().charAt(0).toUpperCase()}
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13.5,
            color: 'var(--color-foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {display}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{handle}</div>
      </div>
    </div>
  );
}

/** Con mắt — `d` chép nguyên từ `Panacea-v3.1.html` (khối XH-VIEWERS). */
function EyeIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--color-muted)', flex: 'none' }}
      aria-hidden
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
    </svg>
  );
}
