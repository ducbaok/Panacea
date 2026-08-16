/**
 * formatCount — định dạng số đếm kiểu Instagram (QĐ-10, FE-6).
 *
 * Quy tắc (ban-do-man-panacea.md §5e):
 *   < 1.000            → số nguyên đầy đủ, KHÔNG dấu ngăn cách   (0 · 7 · 949)
 *   ≥ 1.000            → chia 1.000, 1 chữ số thập phân + K       (1.1K · 999.9K)
 *   ≥ 1.000.000        → + M                                     (1.0M · 128.4M)
 *   ≥ 1.000.000.000    → + B                                     (2.3B)
 *
 * - Làm tròn XUỐNG (cắt cụt), KHÔNG làm tròn lên: 1.199 → "1.1K", 2.031 → "2.0K".
 *   Lý do: làm tròn lên khiến số người theo dõi hiện NHIỀU hơn thật.
 * - Dấu thập phân là dấu CHẤM. Cấm dùng chấm làm dấu ngăn nghìn (1.204 ≠ 1.2K).
 * - Giữ `.0` cho đồng nhất bề rộng cột (1.0M · 2.0K).
 *
 * ⚠️ Tính bằng SỐ NGUYÊN (`v*10/base`) chứ không trừ số thực. `128400/1000` ra
 * 128.39999… trong float ⇒ trừ rồi nhân 10 sẽ cho "128.3K" thay vì "128.4K".
 * `floor(v*10/base)` giữ đúng chữ số thập phân bị cắt.
 *
 * Dùng CHUNG ở: số theo dõi/đang theo dõi (C1a/C1b/C3), số follower khối gợi ý
 * (B1), và mọi số đếm khác toàn app. Một hàm, đừng chép rải rác.
 */
export function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '0';
  const v = Math.max(0, Math.floor(n));
  if (v < 1000) return String(v);

  const units: ReadonlyArray<readonly [number, string]> = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  for (const [base, suffix] of units) {
    if (v >= base) {
      const tenths = Math.floor((v * 10) / base); // cắt cụt tới 1 chữ số thập phân
      return `${Math.floor(tenths / 10)}.${tenths % 10}${suffix}`;
    }
  }
  return String(v);
}
