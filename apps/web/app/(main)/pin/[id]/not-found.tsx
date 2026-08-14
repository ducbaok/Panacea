import Link from 'next/link';

/**
 * FE-4 T2.5 — Trang 404 dành riêng cho /pin/[id]. Được kích hoạt khi
 * `page.tsx` gọi `notFound()` (pin không tồn tại hoặc đã bị chặn).
 *
 * Card này khớp state "404" ở `Panacea.html view=states` — không phải màn
 * trắng, không phải crash. Đợt tương lai (khi FE-5 xong) có thể tô đúng
 * palette đầy đủ; hiện đủ token để nhận diện được.
 */

export default function PinNotFound() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '48px 16px',
      }}
    >
      <div
        role="alert"
        data-state="not-found"
        style={{
          maxWidth: 420,
          width: '100%',
          padding: '28px 24px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 24,
          boxShadow: 'var(--shadow-card)',
          textAlign: 'center',
        }}
      >
        <div
          aria-hidden
          style={{
            fontFamily: 'var(--font-display), var(--font-be-vietnam-pro), sans-serif',
            fontSize: 40,
            color: 'var(--color-primary-strong)',
            marginBottom: 8,
          }}
        >
          404
        </div>
        <div
          style={{
            fontWeight: 700,
            fontSize: 16,
            marginBottom: 8,
            color: 'var(--color-foreground)',
          }}
        >
          Không tìm thấy pin
        </div>
        <p
          style={{
            fontSize: 13.5,
            color: 'var(--color-muted)',
            lineHeight: 1.6,
            margin: '0 0 20px',
          }}
        >
          Pin có thể đã bị xoá, hoặc bạn không có quyền xem.
        </p>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            borderRadius: 'var(--radius-button)',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 13.5,
          }}
        >
          Về trang chủ
        </Link>
      </div>
    </div>
  );
}
