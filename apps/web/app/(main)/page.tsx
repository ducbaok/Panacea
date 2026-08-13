/**
 * Trang tạm ở `/` cho FE-2 — chỉ để bằng chứng T2 chạy được TRONG shell.
 *
 * Trang chủ thật:
 *   • Khách vãng lai → nội dung explore (QĐ-1, FE-3+).
 *   • Đã đăng nhập → homeFeed với 2 nhánh FOLLOWING/EXPLORE (khung-ui-ux §4).
 *
 * FE-3 dựng PinGrid/PinCard sẽ thay hoàn toàn nội dung dưới. Đừng copy layout
 * này — đây không phải chuẩn.
 */
export default function Home() {
  return (
    <div className="px-6 py-8 flex flex-col gap-6">
      <div
        role="note"
        className="rounded-[var(--radius-card)] p-4"
        style={{
          background: 'var(--color-primary-soft)',
          border: '1px solid var(--color-border)',
        }}
      >
        <p
          className="text-sm"
          style={{ color: 'var(--color-foreground)' }}
        >
          <strong>Chỗ giữ chỗ FE-2.</strong> Bạn đang xem shell (Sidebar +
          TopBar + BottomTabBar), lưới pin thật sẽ do <code>FE-3</code> dựng
          (masonry PinGrid). Đăng xuất/đăng nhập để so hai bản shell; thu cửa
          sổ dưới 768px để thấy BottomTabBar.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h1
          className="text-2xl"
          style={{
            fontFamily: 'var(--font-display), var(--font-sans), sans-serif',
            color: 'var(--color-foreground)',
          }}
        >
          Trang chủ (chỗ giữ chỗ)
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Font tiêu đề là <code>Varela Round</code> (§4.1 đã chốt), phần thân
          là <code>Be Vietnam Pro</code>. Nếu thấy hai font trùng nhau, đọc
          console để tìm cảnh báo font-loading.
        </p>
      </div>
    </div>
  );
}
