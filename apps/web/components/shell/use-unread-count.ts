'use client';

import { useQuery } from '@apollo/client/react';
import { useSession } from 'next-auth/react';
import { UnreadNotificationCountDocument } from '@/lib/gql/graphql';

/**
 * Đếm thông báo chưa đọc, hiển thị trên huy hiệu chuông (TopBar + Sidebar).
 *
 * ⚠️ Query bắt buộc auth. Backend trả HTTP 200 + errors[] "Unauthorized" nếu
 * gọi khi chưa đăng nhập (không phải 401). Nếu quên `skip`, shell của khách
 * sẽ bắn 1 request lãng phí mỗi lần vào trang, và mapError sẽ báo 'unauthenticated'
 * — biểu hiện ra ngoài là chỗ nào đó trong shell nuốt lỗi (dấu vết chỉ hiện ở
 * tab Network). Phép T2.4 dùng đúng chỗ này để bắt lỗi quên `skip`.
 *
 * Không phân trang ⇒ dùng `useQuery` thường, KHÔNG dùng useInfinitePagination.
 *
 * `status === 'authenticated'` chặt hơn `!!session`: giai đoạn 'loading' của
 * useSession vẫn có session là undefined nhưng có thể đang khởi tạo — dùng
 * status để đảm bảo chỉ chạy khi Auth.js xác nhận đã có phiên.
 */
export function useUnreadCount(): number {
  const { status } = useSession();
  const { data } = useQuery(UnreadNotificationCountDocument, {
    skip: status !== 'authenticated',
    fetchPolicy: 'cache-and-network',
  });
  return data?.unreadNotificationCount ?? 0;
}
