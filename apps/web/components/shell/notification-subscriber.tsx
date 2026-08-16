'use client';

import { useSubscription } from '@apollo/client/react';
import { useSession } from 'next-auth/react';
import {
  NotificationReceivedDocument,
  NotificationsDocument,
  UnreadNotificationCountDocument,
} from '@/lib/gql/graphql';

/**
 * FE-8 — subscription ĐẦU TIÊN của web. Không render gì; nghe `notificationReceived`
 * trên WS link và cập nhật cache Apollo để:
 *   1. Huy hiệu chuông (`unreadNotificationCount`) tăng NGAY, không F5 — kể cả khi
 *      user đang ở trang khác (đây là chuông ở TopBar/Sidebar, hiện trên mọi trang).
 *   2. Danh sách `/notifications` (nếu trang đầu đã ở cache) chèn thêm dòng lên đầu.
 *
 * Vì sao mount APP-WIDE (trong Providers) chứ không trong trang /notifications:
 * phép quyết định của brief là "A follow B ở tab khác ⇒ chuông của B tăng ngay",
 * mà B có thể đang ở BẤT KỲ trang nào. `skip` khi chưa đăng nhập ⇒ khách không
 * mở socket (graphql-ws lazy ⇒ socket chỉ mở khi có subscription sống).
 *
 * `Notification` mang sẵn `actor`/`pin`/`comment` (đã chọn field khớp query danh
 * sách ở subscription.graphql) ⇒ chèn thẳng vào cache, không query thêm per-dòng.
 */

/** Kích thước trang thông báo — dùng CHUNG giữa subscriber (updateQuery) và trang. */
export const NOTIF_PAGE_SIZE = 20;

export function NotificationSubscriber() {
  const { status } = useSession();

  useSubscription(NotificationReceivedDocument, {
    skip: status !== 'authenticated',
    onData: ({ client, data }) => {
      const incoming = data.data?.notificationReceived;
      if (!incoming) return;
      const cache = client.cache;

      // 1) Tăng badge (nếu query đã ở cache — nếu chưa, badge tự fetch khi mount).
      cache.updateQuery({ query: UnreadNotificationCountDocument }, (prev) =>
        prev
          ? { unreadNotificationCount: (prev.unreadNotificationCount ?? 0) + 1 }
          : prev,
      );

      // 2) Chèn lên đầu trang thông báo đầu tiên (nếu đã ở cache). Bỏ qua nếu
      //    trùng id. `createdAt` gán xấp xỉ phía client (tin VỪA tới ⇒ "Vừa
      //    xong") vì subscription KHÔNG mang được DateTime (bug backend — xem
      //    subscription.graphql). Lần fetch kế thay bằng createdAt thật của server.
      const withTime = { ...incoming, createdAt: new Date().toISOString() };
      cache.updateQuery(
        { query: NotificationsDocument, variables: { first: NOTIF_PAGE_SIZE } },
        (prev) => {
          if (!prev) return prev;
          if (prev.notifications.items.some((it) => it.id === incoming.id)) return prev;
          return {
            ...prev,
            notifications: {
              ...prev.notifications,
              items: [withTime as (typeof prev.notifications.items)[number], ...prev.notifications.items],
            },
          };
        },
      );
    },
  });

  return null;
}
