import type { CSSProperties, ReactNode } from 'react';

/**
 * Mảnh dùng chung cho A1–A5. Số liệu bố cục trích từ khung A1/A2 trong
 * `Panacea.html` (§3.1 của brief FE-5). Token dùng tên DỰ ÁN (`--color-*`) —
 * KHÔNG phải tên mockup (`--surface-2`…), vì FE-1b đã đổi sang quy ước Tailwind
 * v4; chép thẳng tên mockup sẽ ra màu trong suốt mà không báo lỗi (bẫy #2).
 *
 * Không 'use client': thuần style + component không state, dùng được ở cả server
 * page lẫn client form.
 */
export const authStyles = {
  column: { width: '100%', maxWidth: 400 } as CSSProperties,
  header: { textAlign: 'center', marginBottom: 28 } as CSSProperties,
  brand: {
    fontFamily: "'Varela Round', sans-serif",
    fontSize: 28,
    color: 'var(--color-primary-strong)',
  } as CSSProperties,
  subtitle: {
    fontSize: 14,
    color: 'var(--color-muted)',
    marginTop: 6,
    lineHeight: 1.55,
  } as CSSProperties,
  card: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 20,
    padding: 28,
    boxShadow: 'var(--shadow-card)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  } as CSSProperties,
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--color-muted)',
  } as CSSProperties,
  input: {
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface-muted)',
    color: 'var(--color-foreground)',
    fontSize: 14,
    outline: 'none',
  } as CSSProperties,
  submit: {
    padding: 13,
    borderRadius: 999,
    border: 'none',
    background: 'var(--color-primary)',
    color: 'var(--color-primary-foreground)',
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
  } as CSSProperties,
  submitBusy: {
    padding: 13,
    borderRadius: 999,
    border: 'none',
    background: 'var(--color-primary)',
    color: 'var(--color-primary-foreground)',
    fontWeight: 700,
    fontSize: 15,
    cursor: 'not-allowed',
    opacity: 0.7,
  } as CSSProperties,
  hint: { fontSize: 12, color: 'var(--color-muted)' } as CSSProperties,
  errorBox: {
    fontSize: 12.5,
    fontWeight: 600,
    padding: '10px 13px',
    borderRadius: 12,
    background: 'var(--color-surface-muted)',
    color: 'var(--color-danger)',
    border: '1px solid var(--color-border)',
  } as CSSProperties,
  noteBox: {
    fontSize: 12.5,
    fontWeight: 600,
    padding: '10px 13px',
    borderRadius: 12,
    background: 'var(--color-surface-muted)',
    color: 'var(--color-success)',
    border: '1px solid var(--color-border)',
  } as CSSProperties,
  footRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
    color: 'var(--color-muted)',
  } as CSSProperties,
  linkStrong: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'var(--color-primary-strong)',
    fontWeight: 600,
    fontSize: 13,
    textDecoration: 'none',
  } as CSSProperties,
  linkMuted: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'var(--color-muted)',
    fontSize: 13,
    textDecoration: 'none',
  } as CSSProperties,
  backRow: { textAlign: 'center', marginTop: 16 } as CSSProperties,
} as const;

export function AuthHeader({ subtitle }: { subtitle: ReactNode }) {
  return (
    <div style={authStyles.header}>
      <div style={authStyles.brand}>Panacea</div>
      <div style={authStyles.subtitle}>{subtitle}</div>
    </div>
  );
}

/**
 * Chỉ chấp nhận đường dẫn NỘI BỘ. Chặn open-redirect: URL tuyệt đối
 * (`https://evil`), scheme-relative (`//evil`), và backslash lách trình duyệt.
 * Trả '/' khi không hợp lệ.
 */
export function safeCallbackUrl(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || v.length === 0) return '/';
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/';
  return v;
}
