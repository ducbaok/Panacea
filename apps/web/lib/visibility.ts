import { Visibility } from '@/lib/gql/graphql';
import type { TranslationKey, TFunction } from '@/lib/i18n/translate';

/**
 * F1 (XH-8) — mọi thứ dùng chung giữa BỘ CHỌN khán giả và NHÃN QUYỀN trên lưới.
 *
 * Một nguồn cho cả hai vì hai chỗ đó phải nói CÙNG một thứ tiếng: nếu bộ chọn
 * ghi "Một vòng tròn" mà thẻ pin ghi "Riêng tư" thì người dùng không nối được
 * hai màn với nhau, và đó chính là loại nhầm lẫn mà cả mục "chống đăng nhầm"
 * sinh ra để chặn (PLAN_XAHOI.md §9).
 */

/** Thứ tự trong bộ chọn — chép từ bản vẽ, KHÔNG sắp lại theo bảng chữ cái. */
export const VISIBILITY_ORDER: readonly Visibility[] = [
  Visibility.Public,
  Visibility.Followers,
  Visibility.Circle,
  Visibility.OnlyMe,
];

/** `d` của <path> — chép nguyên từ `Panacea-v3.1.html` (VIS_META). */
export const VIS_ICON_PATH: Record<Visibility, string> = {
  [Visibility.Public]:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3.5 9h17 M3.5 15h17 M12 3c-4.5 5.5-4.5 12.5 0 18 4.5-5.5 4.5-12.5 0-18',
  [Visibility.Followers]:
    'M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11z M2.5 19c0-3.2 2.9-5.4 6.5-5.4s6.5 2.2 6.5 5.4 M16 5.4a3.2 3.2 0 0 1 0 6 M18.2 13.9c2 .6 3.3 2.1 3.3 4.3',
  [Visibility.Circle]:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z',
  [Visibility.OnlyMe]: 'M6.5 10.5V8a5.5 5.5 0 0 1 11 0v2.5 M5 10.5h14v9H5z',
};

/** Badge đồng hồ của hạn sống — độc lập với cấp quyền (QĐ-21). */
export const CLOCK_ICON_PATH = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7.5V12l3 2';

export const VIS_LABEL_KEY: Record<Visibility, TranslationKey> = {
  [Visibility.Public]: 'circles.visPublic',
  [Visibility.Followers]: 'circles.visFollowers',
  [Visibility.Circle]: 'circles.visCircle',
  [Visibility.OnlyMe]: 'circles.visOnlyMe',
};

export const VIS_SUB_KEY: Record<Visibility, TranslationKey> = {
  [Visibility.Public]: 'circles.visPublicSub',
  [Visibility.Followers]: 'circles.visFollowersSub',
  [Visibility.Circle]: 'circles.visCircleSub',
  [Visibility.OnlyMe]: 'circles.visOnlyMeSub',
};

/**
 * Tên vòng ad-hoc. Backend cố ý lưu `name` RỖNG (không nhét chuỗi tiếng Việt
 * vào database — `circles.service.ts:26`), nên nhãn phải sinh ở đây.
 */
export function circleDisplayName(
  t: TFunction,
  circle: { name: string; isAdHoc: boolean; memberCount: number } | null | undefined,
): string {
  if (!circle) return '';
  if (circle.name.trim() !== '') return circle.name;
  return t('circles.adHocName', { count: circle.memberCount });
}

/**
 * "còn 6 ngày" / "còn 20 giờ" — cùng công thức với bản vẽ: dưới 48 giờ thì đếm
 * theo giờ, trên thì theo ngày. Trả chuỗi rỗng khi mốc đã qua (pin hết hạn
 * không còn nằm trên lưới của người xem nữa; chủ pin xem ở Kho — luồng F2).
 *
 * 🔴 CÒN HẠN thì LUÔN có chữ (sửa 25/08/2026). Bản cũ làm tròn ra giờ rồi mới
 * chặn `hours <= 0`, nên khoảng dưới ~30 phút — đúng lúc nhãn có ích nhất —
 * trả chuỗi RỖNG, không phân biệt được với pin đã hết hạn: nhãn ở thẻ pin biến
 * mất và echo của bộ chọn hạn sống in ra "Hết hạn 20:00 ngày 25/8 — ." Nay chỉ
 * mốc đã qua mới rỗng; dưới một giờ có nhãn riêng.
 */
export function expiryLeftLabel(t: TFunction, expiresAt: string | null | undefined): string {
  if (!expiresAt) return '';
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return '';
  const ms = at - Date.now();
  if (ms <= 0) return '';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return t('circles.leftUnderHour');
  return hours < 48
    ? t('circles.leftHours', { count: hours })
    : t('circles.leftDays', { count: Math.round(hours / 24) });
}

/**
 * F2 · XH-ARCHIVE — mặt SAU của `expiryLeftLabel`: "Hết hạn 3 ngày trước".
 *
 * Hai hàm cố ý tách đôi thay vì một hàm trả cả hai chiều, vì hai chiều xuất
 * hiện ở hai bề mặt loại trừ nhau: pin CÒN hạn nằm trên lưới của người xem,
 * pin ĐÃ hết hạn chỉ còn ở Kho của chính chủ. Một hàm đổi dấu sẽ mời gọi việc
 * gọi nó ở bề mặt sai và in "còn -3 ngày".
 *
 * Ba mốc (giờ · ngày · tháng) theo đúng từ vựng bản vẽ ("Hết hạn 3 ngày trước"
 * · "Hết hạn 1 tháng trước"). Ngưỡng tháng dùng 30 ngày chẵn — nhãn này là
 * cảm giác thời gian, không phải phép tính lịch.
 *
 * Trả chuỗi rỗng khi chưa hết hạn hoặc thiếu mốc: chỗ gọi ở Kho luôn có
 * `expiresAt` trong quá khứ (backend lọc `expiresAt <= now()`), nên chuỗi rỗng
 * là dấu hiệu gọi nhầm bề mặt chứ không phải trạng thái bình thường.
 */
export function expiredAgoLabel(t: TFunction, expiresAt: string | null | undefined): string {
  if (!expiresAt) return '';
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return '';
  const hours = Math.floor((Date.now() - at) / 3_600_000);
  if (hours < 0) return '';
  if (hours < 1) return t('archive.expiredJustNow');
  if (hours < 24) return t('archive.expiredHoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('archive.expiredDaysAgo', { count: days });
  return t('archive.expiredMonthsAgo', { count: Math.floor(days / 30) });
}

/**
 * Tên khán giả trong hộp xác nhận "riêng → công khai" (chép từ bản vẽ:
 * "Đang chỉ <X> xem được").
 */
export function audienceName(
  t: TFunction,
  visibility: Visibility,
  circleName: string,
): string {
  switch (visibility) {
    case Visibility.Circle:
      return t('circles.audienceCircleName', { name: circleName });
    case Visibility.Followers:
      return t('circles.audienceFollowers');
    case Visibility.OnlyMe:
      return t('circles.audienceOnlyMe');
    default:
      return t('circles.audienceEveryone');
  }
}

/**
 * F2 · XH-ARCHIVE — CHỦ NGỮ ĐẦU CÂU của hộp xác nhận đăng lại ("Mọi người sẽ
 * thấy lại pin này").
 *
 * Vì sao không dùng lại `audienceName` ở trên: bộ chữ kia nằm GIỮA câu ("Đang
 * chỉ vòng Bạn thân xem được") nên viết thường và có giới từ; bộ này đứng ĐẦU
 * câu nên viết hoa và không giới từ. Bản vẽ ghi hai bộ khác nhau ở hai hộp
 * confirm (`xhSetVis` ⇄ `xhArchRepost`) — gộp lại là sai một trong hai chỗ.
 */
export function republishAudienceName(
  t: TFunction,
  visibility: Visibility | null | undefined,
  circleName: string,
): string {
  switch (visibility) {
    case Visibility.Circle:
      return t('archive.audienceCircle', { name: circleName });
    case Visibility.Followers:
      return t('archive.audienceFollowers');
    case Visibility.OnlyMe:
      return t('archive.audienceOnlyMe');
    default:
      return t('archive.audienceEveryone');
  }
}

/** `{count} người · mức thân thiết {rank}` — dòng phụ của một hàng vòng tròn. */
export function circleMeta(
  t: TFunction,
  circle: { memberCount: number; rank?: number | null },
  opts?: { showNoRank?: boolean },
): string {
  const head = t('circles.memberCount', { count: circle.memberCount });
  if (circle.rank != null) return `${head} · ${t('circles.rankSuffix', { rank: circle.rank })}`;
  return opts?.showNoRank ? `${head} · ${t('circles.noRank')}` : head;
}
