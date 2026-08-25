/**
 * Kiểu dùng chung của hai màn vòng tròn (danh sách + chi tiết). Tách ra để hai
 * màn không trôi khỏi nhau — cùng một bản vẽ, cùng một dáng thẻ/nút.
 */

export const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 18,
  color: 'var(--color-foreground)',
};

export const backLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 13.5,
  color: 'var(--color-muted)',
  fontWeight: 600,
  padding: 0,
  marginBottom: 14,
  fontFamily: 'inherit',
};

export const primaryBtn: React.CSSProperties = {
  padding: '11px 22px',
  borderRadius: 999,
  border: 'none',
  background: 'var(--color-primary)',
  color: 'var(--color-primary-foreground)',
  fontWeight: 700,
  fontSize: 13.5,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export const outlineBtn: React.CSSProperties = {
  padding: '11px 22px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-foreground)',
  fontWeight: 600,
  fontSize: 13.5,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export const smallOutlineBtn: React.CSSProperties = {
  ...outlineBtn,
  padding: '9px 16px',
  fontSize: 12.5,
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 14px',
  borderRadius: 12,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-muted)',
  color: 'var(--color-foreground)',
  fontSize: 13.5,
  fontFamily: 'inherit',
  outline: 'none',
};

export const sectionLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-muted)',
};

export const uppercaseHeading: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
  margin: '14px 0 8px',
};
