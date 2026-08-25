'use client';

import { useQuery } from '@apollo/client/react';
import { useSession } from 'next-auth/react';
import {
  MeDocument,
  type MeQuery,
  MyCirclesDocument,
  type MyCirclesQuery,
  type MyCirclesQueryVariables,
  Visibility,
} from '@/lib/gql/graphql';
import {
  CLOCK_ICON_PATH,
  circleDisplayName,
  expiryLeftLabel,
  VIS_ICON_PATH,
  VIS_LABEL_KEY,
} from '@/lib/visibility';
import { useT } from '@/lib/i18n/provider';

/**
 * XH-LABEL — NHÃN QUYỀN trên lưới masonry (QĐ-21, chốt 24/08/2026).
 *
 * 🔴 RÀNG BUỘC CỨNG: badge nằm PHỦ TRÊN ẢNH, không nằm trong khối chữ 67px.
 * `pin-card.tsx` đóng cứng chiều cao khối chữ để masonry tính vị trí bằng số
 * học; nhét thêm một dòng vào đó là thẻ cao lên và đè thẻ bên dưới. Đây là
 * đúng lý do QĐ-21 chọn badge thay vì dòng chữ.
 *
 * Hai vai, hai nội dung khác nhau (spec `spec-man-xahoi-audience.md` §2 + §4):
 *   • CHỦ PIN nhìn lưới của mình  → nhãn ghi ĐÚNG TÊN VÒNG đã đặt.
 *   • NGƯỜI TRONG VÒNG nhìn feed  → chỉ "Chia sẻ riêng", KHÔNG lộ tên vòng.
 *   • Người ngoài không thấy pin (bộ lọc backend), nên không có vai thứ ba.
 *   • PUBLIC không có nhãn cấp — đừng làm bẩn lưới.
 *
 * Badge ĐỒNG HỒ (hạn sống) độc lập với cấp quyền: hiện cả trên pin công khai
 * có hạn. Hai badge dùng chung một khuôn viên, xuống dòng được khi hẹp.
 */

const BADGE_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '5px 9px',
  borderRadius: 999,
  // Nền tối cố định (không phải token) vì badge nằm TRÊN ẢNH: màu nền của theme
  // không nói gì về màu tấm ảnh bên dưới, và chữ phải đọc được trên cả hai.
  background: 'rgba(26, 20, 22, .74)',
  color: '#FFF6F5',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  whiteSpace: 'nowrap',
};

export type PinBadgeInput = {
  visibility?: Visibility | null;
  audienceCircleId?: string | null;
  expiresAt?: string | null;
  creator: { id: string };
};

export function PinBadgeRow({ pin }: { pin: PinBadgeInput }) {
  const t = useT();
  // Danh tính người xem lấy từ query `me` chứ KHÔNG từ session của Auth.js:
  // `session.user` ở dự án này không mang `id` (xem `types/next-auth.d.ts` —
  // chỉ có accessToken), và mọi màn khác đã đọc `meQuery.data.me.id`. Query
  // dùng chung một entry cache nên không tốn thêm request nào.
  const { status } = useSession();
  const meQuery = useQuery<MeQuery>(MeDocument, {
    skip: status !== 'authenticated',
    fetchPolicy: 'cache-first',
  });
  const viewerId = meQuery.data?.me?.id ?? null;

  const visibility = pin.visibility ?? null;
  const isOwner = viewerId != null && viewerId === pin.creator.id;
  const showVis = visibility != null && visibility !== Visibility.Public;

  // Chỉ chủ pin mới cần tra tên vòng ⇒ người khác KHÔNG gọi query này. Apollo
  // gộp mọi thẻ trong lưới về một request (cùng query + cùng biến), nên chi phí
  // là một lần cho cả trang chứ không phải một lần cho mỗi thẻ.
  const needCircleName = showVis && isOwner && visibility === Visibility.Circle;
  const { data } = useQuery<MyCirclesQuery, MyCirclesQueryVariables>(MyCirclesDocument, {
    variables: { includeAdHoc: true },
    skip: !needCircleName,
    fetchPolicy: 'cache-first',
  });

  const expiryLabel = expiryLeftLabel(t, pin.expiresAt);
  if (!showVis && !expiryLabel) return null;

  let visLabel = '';
  if (showVis) {
    if (!isOwner) {
      visLabel = t('circles.sharedPrivately');
    } else if (visibility === Visibility.Circle) {
      const circle = data?.myCircles.find((c) => c.id === pin.audienceCircleId);
      // Chưa nạp xong / vòng đã xoá ⇒ vẫn phải nói được "đây là pin riêng".
      visLabel = circle ? circleDisplayName(t, circle) : t('circles.sharedPrivately');
    } else {
      visLabel = t(VIS_LABEL_KEY[visibility]);
    }
  }

  return (
    <div
      data-screen="XH-LABEL"
      data-visibility={visibility ?? Visibility.Public}
      style={{
        position: 'absolute',
        left: 9,
        top: 9,
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        // Chừa chỗ cho nút Lưu ở góc phải-trên (92px là bề ngang nút + lề).
        maxWidth: 'calc(100% - 92px)',
        // Badge là thông tin, không phải nút: để nó nuốt click là chặn mất cả
        // thao tác mở pin.
        pointerEvents: 'none',
      }}
    >
      {showVis && (
        <span data-testid="pin-visibility-badge" style={BADGE_STYLE}>
          <BadgeIcon path={VIS_ICON_PATH[visibility]} />
          {visLabel}
        </span>
      )}
      {expiryLabel && (
        <span data-testid="pin-expiry-badge" style={BADGE_STYLE}>
          <BadgeIcon path={CLOCK_ICON_PATH} />
          {expiryLabel}
        </span>
      )}
    </div>
  );
}

function BadgeIcon({ path }: { path: string }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}
