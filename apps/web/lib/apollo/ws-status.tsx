'use client';

import { createContext, useContext } from 'react';

/**
 * FE-8 — trạng thái kết nối WebSocket (graphql-ws) phơi ra cho UI.
 *
 * Vì sao cần: subscription chạy trên socket riêng (`graphql-ws`). Khi socket rụng
 * (mạng chập, hoặc token cũ bị backend đóng 4403 lúc xoay token — điểm mù FE-0
 * `apollo/provider.tsx`), UI phải hiện "Đang kết nối lại…" như bản vẽ D2. React
 * không thấy được sự kiện socket ⇒ provider bắc cầu event graphql-ws → state này.
 *
 * - `idle`       : chưa mở socket (chưa có subscription nào / chưa đăng nhập).
 * - `connecting` : đang bắt tay hoặc đang thử nối lại.
 * - `connected`  : socket đang mở, subscription sống.
 * - `closed`     : socket đóng và chưa nối lại được.
 *
 * Banner D2 hiện khi trạng thái KHÁC `connected`/`idle` (tức đang chật vật nối).
 */
export type WsStatus = 'idle' | 'connecting' | 'connected' | 'closed';

export const WsStatusContext = createContext<WsStatus>('idle');

export function useWsStatus(): WsStatus {
  return useContext(WsStatusContext);
}
