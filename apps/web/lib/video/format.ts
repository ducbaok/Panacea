/**
 * XH-VIDEO — `m:ss` cho thời lượng đoạn quay.
 *
 * Ở chung một chỗ vì có hai bề mặt vẽ cùng con số này (badge ▶ trên thẻ lưới,
 * dòng phụ ở màn chi tiết) và chúng PHẢI khớp nhau — người dùng thấy "0:15"
 * trên lưới rồi mở ra gặp "0:14" thì cái sai đó không có lời giải thích nào.
 *
 * LÀM TRÒN, không cắt xuống: một đoạn 14,7s là "0:15" chứ không phải "0:14".
 * Sàn ở 1 giây — mọi đoạn quay đều dài hơn 0 giây, và "0:00" đọc như lỗi.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
