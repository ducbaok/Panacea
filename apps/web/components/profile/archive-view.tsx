'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useArchivedPins } from '@/lib/hooks/usePaginatedQuery';
import { PinGrid } from '@/components/pin/pin-grid';
import type { PinCardItem } from '@/components/pin/pin-card';
import { expiredAgoLabel, CLOCK_ICON_PATH } from '@/lib/visibility';
import { useLocale, useT } from '@/lib/i18n/provider';
import type { TFunction } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';

/**
 * XH-ARCHIVE — KHO pin đã hết hạn. Tab CHỈ CHÍNH CHỦ thấy (QĐ-24, chốt 24/08).
 *
 * Ngữ nghĩa (đừng dựng ngược — `spec-man-xahoi-archive.md` §1):
 *   • Không có "story". Pin thường đặt được hạn sống; hết hạn = biến mất khỏi
 *     MỌI bề mặt (kể cả hồ sơ của chính chủ) rồi rơi vào đây. Vẫn là lưới
 *     masonry — ràng buộc gốc của cả hướng đi, nên dùng lại `PinGrid` nguyên
 *     vẹn chứ không vẽ lưới riêng.
 *   • Bình luận/cảm xúc trên pin hết hạn GIỮ NGUYÊN: mở thẻ ra là sang đúng
 *     `/pin/{id}` như mọi lưới khác (backend cho chính chủ mở pin hết hạn qua
 *     link trực tiếp). Không có màn chi tiết thứ hai — spec §1 trạng thái 3 ghi
 *     rõ "như chi tiết pin thường + nút Đăng lại + giữ nút xoá", và nút Đăng
 *     lại đã nằm ở `pin-detail.tsx`.
 *   • "Kho là kho, không phải nghĩa địa."
 *
 * 🔴 KHÔNG có dải "một năm trước hôm nay" — QĐ-24 chốt BỎ, chỉ nhóm theo tháng.
 * Đây là chốt NGƯỢC với đề xuất ban đầu của spec (§0 Q2); ai đọc spec mà không
 * đọc phần đã-chốt sẽ dựng lại đúng cái dải bị bỏ.
 *
 * NHÓM THEO THÁNG ĐĂNG (`createdAt`), KHÔNG phải tháng hết hạn. Lý do đo được:
 * backend sắp kho theo keyset `(createdAt, id) DESC`, nên nhóm theo `createdAt`
 * là dãy ĐƠN ĐIỆU — mỗi tiêu đề tháng xuất hiện đúng một lần, kể cả sau khi
 * cuộn thêm trang. `expiresAt` thì không: pin đăng tháng 6 đặt hạn 3 tháng sẽ
 * hết hạn sau pin đăng tháng 8 đặt hạn 1 ngày, và tiêu đề tháng sẽ mọc lại
 * giữa chừng. Mốc hết hạn vẫn hiện — trên badge của từng thẻ.
 */
export function ArchiveView() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();

  const archive = useArchivedPins();
  const items = archive.items as unknown as ArchivedItem[];

  const groups = useMemo(() => groupByPostMonth(items, t, locale), [items, t, locale]);

  if (archive.loading && items.length === 0) {
    return <ArchiveNotice>{t('archive.loading')}</ArchiveNotice>;
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: '0 16px 24px' }}>
        <div
          data-screen="XH-ARCHIVE"
          data-state="empty"
          style={{
            padding: '64px 24px',
            textAlign: 'center',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 20,
          }}
        >
          <div style={{ fontSize: 21, fontWeight: 700, color: 'var(--color-foreground)' }}>
            {t('archive.emptyTitle')}
          </div>
          <div
            style={{
              fontSize: 14,
              color: 'var(--color-muted)',
              marginTop: 8,
              lineHeight: 1.6,
              maxWidth: 440,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            {t('archive.emptyBody')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-screen="XH-ARCHIVE" data-state="list">
      {groups.map((group, index) => {
        // Sentinel cuộn-vô-hạn của `PinGrid` nằm TRONG mỗi lưới, nên chỉ nhóm
        // CUỐI được cầm `hasNextPage`/`loadMore`. Trao cho mọi nhóm thì mỗi
        // tiêu đề tháng lại kéo thêm một trang khi lướt qua, và tất cả cùng
        // gọi `fetchMore` với cùng một cursor.
        const isLast = index === groups.length - 1;
        return (
          <section key={group.key} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: 'var(--color-muted)',
                margin: '0 16px 12px',
              }}
            >
              {group.label}
            </div>
            <PinGrid
              items={group.items as unknown as PinCardItem[]}
              loading={false}
              loadingMore={isLast && archive.loadingMore}
              hasNextPage={isLast && archive.hasNextPage}
              loadMore={archive.loadMore}
              onOpen={(id) => router.push(`/pin/${id}`)}
              renderOverlay={(item) => (
                <ExpiredBadge expiresAt={(item as unknown as ArchivedItem).expiresAt} />
              )}
            />
          </section>
        );
      })}
    </div>
  );
}

/**
 * Badge "Hết hạn X trước" — dấu hiệu bắt buộc của mỗi thẻ trong kho (spec §1
 * trạng thái 1).
 *
 * Đặt ở góc TRÁI-DƯỚI chứ không trái-trên như bản vẽ, và đó là một khác biệt
 * CÓ LÝ DO chứ không phải lệch: bản vẽ dựng thẻ kho trần, còn thẻ thật đã có
 * `PinBadgeRow` (F1 · QĐ-21) chiếm sẵn góc trái-trên bằng nhãn quyền, góc
 * phải-trên là nút Lưu. Chồng badge lên nhau mới là phản bội bản vẽ; ba góc
 * khác nhau cho ba thông tin khác nhau thì không.
 *
 * `pointerEvents: none` — badge là thông tin, không phải nút. Để nó nuốt click
 * là chặn mất thao tác mở pin (cùng lý do đã ghi ở `pin-badges.tsx`).
 */
function ExpiredBadge({ expiresAt }: { expiresAt: string | null | undefined }) {
  const t = useT();
  const label = expiredAgoLabel(t, expiresAt);
  if (!label) return null;
  return (
    <span
      data-testid="pin-expired-badge"
      style={{
        position: 'absolute',
        left: 9,
        bottom: 9,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 9px',
        borderRadius: 999,
        // Nền tối cố định (không phải token) vì badge nằm TRÊN ẢNH — màu nền
        // của theme không nói gì về màu tấm ảnh bên dưới.
        background: 'rgba(26, 20, 22, .74)',
        color: '#FFF6F5',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        maxWidth: 'calc(100% - 18px)',
        overflow: 'hidden',
      }}
    >
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
        <path d={CLOCK_ICON_PATH} />
      </svg>
      {label}
    </span>
  );
}

function ArchiveNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '48px 16px',
        textAlign: 'center',
        color: 'var(--color-muted)',
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}

// ─── Nhóm theo tháng ──────────────────────────────────────────────────────────

type ArchivedItem = PinCardItem & { createdAt: string; expiresAt?: string | null };

type MonthGroup = { key: string; label: string; items: ArchivedItem[] };

/**
 * Gom danh sách ĐÃ SẮP của backend thành các nhóm tháng liền mạch.
 *
 * Quét tuyến tính và mở nhóm mới mỗi khi khoá tháng đổi — CỐ Ý không dùng
 * `Map`/`groupBy` rồi sắp lại: thứ tự nhóm phải là thứ tự backend trả về, và
 * gom bằng Map sẽ âm thầm "sửa" cả những trường hợp dữ liệu không đơn điệu
 * thay vì để chúng lộ ra.
 */
export function groupByPostMonth(
  items: ArchivedItem[],
  t: TFunction,
  locale: Locale,
  now: Date = new Date(),
): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const item of items) {
    const at = new Date(item.createdAt);
    if (!Number.isFinite(at.getTime())) continue;
    const key = `${at.getFullYear()}-${at.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }
    groups.push({ key, label: monthLabel(at, t, locale, now), items: [item] });
  }
  return groups;
}

/**
 * "Tháng này" · "Tháng 7" · "Tháng 7/2025".
 *
 * Biến thể kèm NĂM không có trong bản vẽ (mock chỉ dựng 3 tháng gần nhau) —
 * thêm vào vì không có nó thì kho của năm sau hiện hai tiêu đề "Tháng 7" giống
 * hệt nhau cách nhau vài màn cuộn.
 *
 * `monthName` truyền kèm cho bản tiếng Anh (bản vi dùng số tháng, bản en dùng
 * tên tháng — xem `dictionaries/en/archive.ts`).
 */
function monthLabel(at: Date, t: TFunction, locale: Locale, now: Date): string {
  const sameYear = at.getFullYear() === now.getFullYear();
  if (sameYear && at.getMonth() === now.getMonth()) return t('archive.groupThisMonth');
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long' }).format(at);
  const vars = { month: at.getMonth() + 1, monthName, year: at.getFullYear() };
  return sameYear ? t('archive.groupMonth', vars) : t('archive.groupMonthYear', vars);
}
