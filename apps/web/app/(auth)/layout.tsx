/**
 * Layout nhóm route `(auth)` — căn giữa, KHÔNG có shell chính (Sidebar/TopBar/
 * BottomTabBar). Khớp khung A1/A2 của mockup: min-height 100vh, flex center,
 * padding 40px 20px, nền `--color-background`. Các trang con chỉ dựng cột 400px.
 *
 * KHÔNG 'use client' — chỉ là khung tĩnh.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        background: 'var(--color-background)',
        color: 'var(--color-foreground)',
        fontFamily: "'Be Vietnam Pro', sans-serif",
      }}
    >
      {children}
    </div>
  );
}
