'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PinCard, TEXT_BLOCK_HEIGHT, cardHeight, type PinCardItem } from './pin-card';
import { useT } from '@/lib/i18n/provider';

/**
 * FE-3 — Masonry theo khuôn `fullWidthLayout` của Gestalt (Pinterest).
 *
 * Nguồn: PROMPT_FE3.md §4 (đọc thẳng mã nguồn mở của Pinterest 13/08/2026).
 * KHÔNG dùng CSS columns cho lưới thật (§4.1): (a) xáo vị trí khi loadMore
 * vì browser cân bằng cột với `columns` chiều cao auto; (b) thứ tự đọc theo
 * cột không khớp thứ tự thời gian của keyset feed. Pinterest đã đi CSS → JS.
 *
 * Thuật toán (§4.2, 12 dòng):
 *   heights = [0, 0, ..., 0]                      # một số 0 mỗi cột
 *   for item in items:
 *     col = mindex(heights)                       # cột thấp nhất, ưu tiên TRÁI nhất
 *     top = heights[col]
 *     left = col * (columnWidth + gutter) + centerOffset
 *     heights[col] += cardHeight(item) + gutter
 *   containerHeight = max(heights)
 *
 * Ổn định KHÔNG đến từ cache — hàm thuần của (danh sách, chiều cao, số cột,
 * bề rộng). Đừng dựng position store (§4.2).
 *
 * Số cột co giãn theo `fullWidthLayout` (§4.3):
 *   colguess    = floor(width / ideal)
 *   columnCount = max(floor((width - colguess * gutter) / ideal), minCols)
 *   columnWidth = width / columnCount - gutter    # co giãn, không cố định 236
 *   centerOffset = gutter / 2
 *
 * Hằng số của Pinterest (§4.3): ideal=240, minCols=2, gutter=14. Mockup dự
 * án dùng gutter=16 ⇒ GIỮ 16 theo mockup. columnWidth co giãn xoay quanh
 * 236px của mockup theo bề rộng vùng nội dung thật.
 *
 * BỀ RỘNG PHẢI ĐO TRÊN CONTAINER, KHÔNG window.innerWidth (§5 phép 1). Đây
 * là hệ quả trực tiếp của QĐ-3: cột trái thu/mở đổi vùng nội dung mà
 * innerWidth không đổi. Phép quyết định T2.1 đúng để bắt lỗi này.
 *
 * Ba ràng buộc (§4.4):
 *   1. cardHeight BẤT BIẾN sau lần render đầu — do PinCard đóng cứng.
 *   2. Thứ tự item ổn định (keyset backend đảm bảo). Đừng sort lại ở client.
 *   3. Container cao tường minh = max(heights). Con vị trí tuyệt đối không
 *      đẩy chiều cao cha. Thiếu dòng này thì thanh cuộn sai và cuộn vô hạn
 *      không kích hoạt.
 *
 * Loading (§4.7): khung xương dùng CSS columns (chỗ dùng multicol ĐÚNG —
 * skeleton tĩnh, không phân trang, không có thứ tự có nghĩa). Tỉ lệ tất định
 * theo mảng mẫu để tránh lệch hydration (bẫy 11).
 *
 * LoadingMore: con quay ở ĐÁY, giữ nguyên lưới (§4.7 ràng buộc 3).
 */

const IDEAL_COLUMN_WIDTH = 240;
const DEFAULT_COLUMN_WIDTH = 236; // dùng ở khung xương SSR (columns:<width>)
const GUTTER = 16;
const MIN_COLS = 2;
/**
 * Đề kháng nhiễu dưới-pixel: bỏ qua thay đổi bề rộng < 1px. Bề rộng thật là
 * số thực (1056.8px…) nên làm tròn của trình duyệt có thể bắn RO với chênh
 * lệch cỡ 0.01px; mỗi lần như vậy là một lượt `computeLayout` O(n) vô ích.
 * Ngưỡng nhỏ hơn 1px ⇒ không bao giờ nuốt mất một lần đổi layout thật.
 */
const MIN_WIDTH_DELTA = 1;

/**
 * Mảng mẫu tỉ lệ khung xương — CỐ ĐỊNH, lặp theo chỉ số. KHÔNG dùng random.
 * Bẫy 11 §6: `Math.random()` ⇒ server sinh một bộ tỉ lệ, client bộ khác ⇒
 * React báo hydration mismatch. Dùng mảng cố định lặp theo index thì server
 * và client cùng ra một chuỗi.
 */
const SKELETON_RATIOS = [3 / 4, 1, 2 / 3, 4 / 5, 3 / 4, 5 / 4, 2 / 3, 3 / 4, 4 / 5, 3 / 5, 3 / 4, 1];
const SKELETON_COUNT = 12;

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type Position = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type Layout = {
  positions: Position[];
  columnWidth: number;
  columnCount: number;
  containerHeight: number;
};

/**
 * Xuất ra làm hàm thuần để test được không cần render — cũng là chứng minh
 * §4.2 "hàm thuần của (danh sách theo thứ tự, chiều cao, số cột, bề rộng)".
 */
export function computeLayout(items: PinCardItem[], containerWidth: number): Layout {
  const colguess = Math.max(1, Math.floor(containerWidth / IDEAL_COLUMN_WIDTH));
  const columnCount = Math.max(
    Math.floor((containerWidth - colguess * GUTTER) / IDEAL_COLUMN_WIDTH),
    MIN_COLS,
  );
  const columnWidth = containerWidth / columnCount - GUTTER;
  const centerOffset = GUTTER / 2;

  const heights: number[] = new Array(columnCount).fill(0);
  const positions: Position[] = items.map((item) => {
    const h = cardHeight(item, columnWidth);
    // mindex — first-occurring minimum ⇒ hàng đầu đổ TRÁI→PHẢI theo thứ tự
    // thời gian của keyset feed.
    let col = 0;
    let minH = heights[0];
    for (let i = 1; i < columnCount; i++) {
      if (heights[i] < minH) {
        minH = heights[i];
        col = i;
      }
    }
    const top = heights[col];
    const left = col * (columnWidth + GUTTER) + centerOffset;
    heights[col] = minH + h + GUTTER;
    return { top, left, width: columnWidth, height: h };
  });

  return {
    positions,
    columnWidth,
    columnCount,
    containerHeight: heights.length ? Math.max(...heights) : 0,
  };
}

/**
 * Bề rộng **content-box** của container lưới — nguồn sự thật DUY NHẤT.
 *
 * Vì sao không dùng thẳng `getBoundingClientRect().width`: container mang
 * `px-4 md:px-6` ⇒ rect là *border-box*, dư 32–48px so với vùng thật đặt được
 * thẻ. Trước đây lần đo đầu dùng rect (border-box) còn ResizeObserver dùng
 * `entry.contentRect` (content-box) ⇒ frame đầu tính dư 48px, đủ để nhảy thêm
 * MỘT cột và tràn ngang ~55px (nháy thanh cuộn ngang ở MỌI lần mount lưới).
 *
 * Vì sao không dùng `entry.contentRect` làm nguồn: nó chỉ có trong callback
 * của RO, nên lần đo đầu buộc phải đi đường khác — tức là lại hai hệ đo. Đọc
 * ở đây thì cả hai đường dùng chung một phép tính. RO bắn *sau* layout nên
 * lần đọc này không gây reflow thừa.
 */
function measureContentWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const w =
    el.getBoundingClientRect().width -
    parseFloat(cs.paddingLeft) -
    parseFloat(cs.paddingRight) -
    parseFloat(cs.borderLeftWidth) -
    parseFloat(cs.borderRightWidth);
  return w > 0 ? w : 0;
}

type Props = {
  items: PinCardItem[];
  loading: boolean;
  loadingMore: boolean;
  hasNextPage: boolean;
  loadMore: () => void;
  /** FE-4 sẽ cắm điều hướng modal/(.)pin/[id]. FE-3 để trống hành vi. */
  onOpen?: (id: string) => void;
  /**
   * FE-10 — overlay theo ngữ cảnh cho từng thẻ (xem prop `overlay` của PinCard).
   * Lưới chỉ chuyển tiếp, không biết nội dung: C4 dùng để cắm badge "Ảnh bìa" +
   * menu ⋯ "Đặt làm bìa".
   */
  renderOverlay?: (item: PinCardItem) => React.ReactNode;
};

export function PinGrid({
  items,
  loading,
  loadingMore,
  hasNextPage,
  loadMore,
  onOpen,
  renderOverlay,
}: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // MỘT hệ đo duy nhất: `measureContentWidth` là nguồn sự thật cho CẢ lần đo
    // đầu LẪN mọi lần ResizeObserver bắn. RO chỉ dùng làm *kích hoạt*, không
    // đọc `entry.contentRect` — trộn hai hệ đo chính là gốc của bug rung.
    const read = () => {
      const w = measureContentWidth(el);
      // Lưới ẩn (`display:none` — tab Khám phá) đo ra 0: giữ nguyên trạng thái
      // cũ thay vì tính lưới 0 cột. Khi tab hiện lại, RO bắn với bề rộng thật.
      if (w > 0) setContainerWidth((prev) => (prev !== null && Math.abs(prev - w) < MIN_WIDTH_DELTA ? prev : w));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sentinel + IntersectionObserver ⇒ tự loadMore khi cạnh dưới lưới sắp lộ.
  const stableLoadMore = useCallback(() => {
    if (!loadingMore && hasNextPage) loadMore();
  }, [loadingMore, hasNextPage, loadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) stableLoadMore();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasNextPage, stableLoadMore]);

  const layout = useMemo<Layout | null>(() => {
    if (containerWidth === null) return null;
    return computeLayout(items, containerWidth);
  }, [items, containerWidth]);

  const showSkeleton = loading && items.length === 0;

  return (
    <div
      ref={containerRef}
      className="px-4 md:px-6"
      style={{ position: 'relative' }}
    >
      {showSkeleton ? (
        <div
          aria-hidden
          style={{
            columns: `${DEFAULT_COLUMN_WIDTH}px`,
            columnGap: `${GUTTER}px`,
          }}
        >
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => {
            const ratio = SKELETON_RATIOS[i % SKELETON_RATIOS.length];
            return (
              <div
                key={i}
                style={{
                  breakInside: 'avoid',
                  marginBottom: `${GUTTER}px`,
                }}
              >
                <div
                  style={{
                    aspectRatio: `1 / ${ratio}`,
                    borderRadius: 'var(--radius-card)',
                    background: 'var(--color-surface-muted)',
                    boxShadow: 'var(--shadow-card)',
                  }}
                />
                <div style={{ height: `${TEXT_BLOCK_HEIGHT}px` }} />
              </div>
            );
          })}
        </div>
      ) : layout ? (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: `${layout.containerHeight}px`,
          }}
        >
          {items.map((item, i) => {
            const pos = layout.positions[i];
            return (
              <div
                key={item.id}
                data-pin-id={item.id}
                style={{
                  position: 'absolute',
                  top: `${pos.top}px`,
                  left: `${pos.left}px`,
                  width: `${pos.width}px`,
                }}
              >
                <PinCard
                  item={item}
                  columnWidth={pos.width}
                  onOpen={onOpen}
                  overlay={renderOverlay?.(item)}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Sentinel — chỉ render khi còn trang; tự huỷ khi hết */}
      {hasNextPage && <div ref={sentinelRef} aria-hidden style={{ height: '1px' }} />}

      {/* LoadingMore — con quay ở đáy, KHÔNG thay lưới (§4.7 ràng buộc 3) */}
      {loadingMore && (
        <div
          role="status"
          aria-label={t('pin.loadingMore')}
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '24px 0',
          }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: '2px solid var(--color-border)',
              borderTopColor: 'var(--color-primary-strong)',
              animation: 'pin-grid-spin 800ms linear infinite',
              display: 'inline-block',
            }}
          />
        </div>
      )}
    </div>
  );
}
