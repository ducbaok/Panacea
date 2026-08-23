'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { authStyles, AuthHeader } from '@/components/auth/auth-ui';
import { useT } from '@/lib/i18n/provider';

/**
 * A1 — form đăng ký. So với A2 thêm ô "Tên hiển thị" (BẮT BUỘC — `RegisterDto`
 * đòi `name` 2..50, §4.1) và kiểm mật khẩu < 8 ở CLIENT (chỉ đăng ký mới kiểm,
 * §3.2). Đăng ký xong tự vào phiên ngay (signIn, T2.5).
 */
type RegError =
  | null
  | { kind: 'short' }
  | { kind: 'name' }
  | { kind: 'email-taken' }
  | { kind: 'invalid' }
  | { kind: 'network' };

export function RegisterForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RegError>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    // Kiểm ở client (chỉ đăng ký — §3.2): name 2..50, mật khẩu ≥ 8.
    if (name.trim().length < 2) {
      setError({ kind: 'name' });
      return;
    }
    if (password.length < 8) {
      setError({ kind: 'short' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!data.ok) {
        if (data.reason === 'email-taken') setError({ kind: 'email-taken' });
        else if (data.reason === 'network') setError({ kind: 'network' });
        else setError({ kind: 'invalid' });
        setBusy(false);
        return;
      }
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        // Tài khoản đã tạo nhưng dựng phiên hỏng — đẩy sang đăng nhập.
        router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError({ kind: 'network' });
      setBusy(false);
    }
  }

  const errorText =
    error?.kind === 'short'
      ? t('auth.errPasswordShort')
      : error?.kind === 'name'
        ? t('auth.errNameShort')
        : error?.kind === 'email-taken'
          ? t('auth.errEmailTaken')
          : error?.kind === 'invalid'
            ? t('auth.errInvalidInput')
            : error?.kind === 'network'
              ? t('auth.errNetwork')
              : null;

  const loginHref =
    callbackUrl && callbackUrl !== '/'
      ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : '/login';

  return (
    <div style={authStyles.column}>
      <AuthHeader subtitle={t('auth.registerSubtitle')} />
      <form style={authStyles.card} onSubmit={onSubmit} noValidate>
        <label style={authStyles.label}>
          {t('auth.displayName')}
          <input
            type="text"
            autoComplete="name"
            placeholder={t('auth.displayNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={authStyles.input}
          />
        </label>
        <label style={authStyles.label}>
          {t('auth.email')}
          <input
            type="email"
            autoComplete="email"
            placeholder={t('auth.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={authStyles.input}
          />
        </label>
        <label style={authStyles.label}>
          {t('auth.password')}
          <input
            type="password"
            autoComplete="new-password"
            placeholder={t('auth.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={authStyles.input}
          />
        </label>
        <div style={authStyles.hint}>{t('auth.passwordHint')}</div>
        {errorText && <div style={authStyles.errorBox}>{errorText}</div>}
        <button type="submit" style={busy ? authStyles.submitBusy : authStyles.submit} disabled={busy}>
          {busy ? t('auth.creatingAccount') : t('auth.register')}
        </button>
        {/* OAuth Google: CHƯA VẼ (Q2) — nút chờ bản vẽ, xem login-form.tsx. */}
        <div style={authStyles.footRow}>
          <span />
          <Link href={loginHref} style={authStyles.linkStrong}>
            {t('auth.haveAccount')}
          </Link>
        </div>
      </form>
      <div style={authStyles.backRow}>
        <Link href="/" style={authStyles.linkMuted}>
          ← {t('auth.backToGrid')}
        </Link>
      </div>
    </div>
  );
}
