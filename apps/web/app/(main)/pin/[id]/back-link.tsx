'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { useT } from '@/lib/i18n/provider';

/**
 * "← Quay lại lưới" — dùng router.back() nếu có history same-origin, không
 * thì fallback về `/`. Đúng cách này giữ vị trí cuộn của lưới (đúng tinh
 * thần cặp sinh đôi QĐ-2 và T2.1).
 */
export function BackToGridLink() {
  const t = useT();
  const router = useRouter();
  const onClick = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  }, [router]);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 13.5,
        color: 'var(--color-muted)',
        fontWeight: 600,
        padding: 0,
        marginBottom: 16,
      }}
    >
      ← {t('pin.backToGrid')}
    </button>
  );
}
