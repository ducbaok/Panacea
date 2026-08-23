'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@apollo/client/react';
import { UnblockUserDocument } from '@/lib/gql/graphql';
import { useBlockedUsers } from '@/lib/hooks/usePaginatedQuery';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/lib/i18n/provider';

/**
 * C2b — Người đã chặn (FE-6, view=blocked). Đường bỏ chặn DUY NHẤT trong app
 * (QĐ-7). Route con của /settings ⇒ đã được proxy bảo vệ. Chữ chép nguyên văn
 * từ Panacea-v2.html (§9). 3 trạng thái: neterr · empty · list.
 */
export default function BlockedListPage() {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { items, loading, error, loadingMore, hasNextPage, loadMore } = useBlockedUsers({ first: 20 });
  const [unblockM] = useMutation(UnblockUserDocument);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const rows = items.filter((u) => !removed.has(u.id));

  async function onUnblock(u: (typeof items)[number]) {
    const handle = `@${u.username ?? ''}`;
    const ok = await confirm({
      title: t('settings.unblockTitle', { handle }),
      body: t('settings.unblockBody'),
      yesLabel: t('settings.unblock'),
    });
    if (!ok) return;
    setRemoved((s) => new Set(s).add(u.id)); // optimistic
    try {
      await unblockM({ variables: { userId: u.id } });
      toast({ message: t('settings.unblockDone', { handle }) });
    } catch {
      setRemoved((s) => {
        const n = new Set(s);
        n.delete(u.id);
        return n;
      });
      toast({ message: t('settings.unblockFailed') });
    }
  }

  return (
    <div style={{ padding: '24px 16px 40px' }} data-screen="C2-blocked">
      <button
        type="button"
        onClick={() => router.push('/settings')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--color-muted)', fontWeight: 600, padding: 0, marginBottom: 14 }}
      >
        ← {t('settings.title')}
      </button>
      <h1 style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 24, margin: '0 0 18px', color: 'var(--color-foreground)' }}>
        {t('settings.blocked')}
      </h1>

      <div style={{ maxWidth: 560 }}>
        {error ? (
          <StateCard>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{t('settings.blockedLoadFailed')}</div>
            <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>{t('common.checkNetwork')}</div>
          </StateCard>
        ) : loading && rows.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-muted)', fontSize: 14 }}>{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <StateCard>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{t('settings.blockedEmpty')}</div>
            <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6, lineHeight: 1.6 }}>
              {t('settings.blockedEmptyHint')}
            </div>
          </StateCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((u) => (
              <div
                key={u.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: 14,
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <RowAvatar name={u.name ?? u.username} url={u.avatarUrl} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-foreground)' }}>{u.name ?? u.username}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>@{u.username}</div>
                </div>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => onUnblock(u)}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 999,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-foreground)',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.unblock')}
                </button>
              </div>
            ))}
            {hasNextPage && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                style={{ marginTop: 6, padding: '10px', borderRadius: 12, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)', fontSize: 13, cursor: 'pointer' }}
              >
                {loadingMore ? t('common.loading') : t('common.loadMore')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StateCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '48px 20px', textAlign: 'center', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20 }}>
      {children}
    </div>
  );
}

function RowAvatar({ name, url }: { name?: string | null; url?: string | null }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (url) {
    return <img src={url} alt={name ?? ''} style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />;
  }
  return (
    <div
      aria-hidden
      style={{
        width: 42,
        height: 42,
        borderRadius: '50%',
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        flex: 'none',
      }}
    >
      {initial}
    </div>
  );
}
