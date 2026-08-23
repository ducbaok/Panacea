'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { authStyles, AuthHeader } from '@/components/auth/auth-ui';
import { useT } from '@/lib/i18n/provider';

/**
 * A2 — form đăng nhập. Bốn trạng thái lỗi (§3.2), chữ chép ĐÚNG mockup:
 *   invalid      → "Email hoặc mật khẩu không đúng."           (401 · và 400 mật khẩu ngắn — §3.2)
 *   just-locked  → "Sai 5 lần — tài khoản vừa bị tạm khoá 15 phút."  (403 "Too many failed attempts")
 *   locked       → "Đang bị khoá. Thử lại sau {n} giây."       (403 "…Try again in {n}s") — số THẬT, đếm ngược
 *   network      → "Không kết nối được máy chủ. Thử lại sau."
 *
 * §3.2 (bản 14/08): login KHÔNG kiểm độ dài mật khẩu ở client — mật khẩu < 8 đi
 * tới backend rồi hiện như "sai thông tin". Chỉ A1 (đăng ký) mới kiểm ở client.
 *
 * Direction A (§4.2): gọi /api/auth/password-login để lấy LỖI CHÍNH XÁC, chỉ
 * `signIn('credentials')` SAU khi route trả ok — nên nhánh nuốt-lỗi của
 * `authorize()` không che mất trạng thái nào.
 */
type LoginError =
  | null
  | { kind: 'invalid' }
  | { kind: 'just-locked' }
  | { kind: 'locked'; sec: number }
  | { kind: 'network' };

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoginError>(null);
  const [lockSec, setLockSec] = useState(0);

  // Đồng hồ đếm ngược khoá: khởi tạo + tick trong useEffect, KHÔNG tính lúc
  // render (bẫy #9 — lệch hydration). setInterval chỉ chạy client.
  useEffect(() => {
    if (error?.kind === 'locked') setLockSec(error.sec);
  }, [error]);
  useEffect(() => {
    if (error?.kind !== 'locked' || lockSec <= 0) return;
    const t = setInterval(() => setLockSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [error, lockSec]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/password-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!data.ok) {
        if (data.reason === 'locked') setError({ kind: 'locked', sec: Number(data.retryAfterSec) || 900 });
        else if (data.reason === 'just-locked') setError({ kind: 'just-locked' });
        else if (data.reason === 'network') setError({ kind: 'network' });
        else setError({ kind: 'invalid' });
        setBusy(false);
        return;
      }
      // Đăng nhập backend OK ⇒ dựng phiên Auth.js (authorize chạy login lần nữa,
      // thành công nên không lệch bộ đếm khoá).
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError({ kind: 'invalid' });
        setBusy(false);
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
    error?.kind === 'invalid'
      ? t('auth.errInvalidCredentials')
      : error?.kind === 'just-locked'
        ? t('auth.errJustLocked')
        : error?.kind === 'locked'
          ? t('auth.errLocked', { sec: lockSec })
          : error?.kind === 'network'
            ? t('auth.errNetwork')
            : null;

  const registerHref =
    callbackUrl && callbackUrl !== '/'
      ? `/register?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : '/register';

  return (
    <div style={authStyles.column}>
      <AuthHeader subtitle={t('auth.loginSubtitle')} />
      <form style={authStyles.card} onSubmit={onSubmit} noValidate>
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
            autoComplete="current-password"
            placeholder={t('auth.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={authStyles.input}
          />
        </label>
        {errorText && <div style={authStyles.errorBox}>{errorText}</div>}
        <button type="submit" style={busy ? authStyles.submitBusy : authStyles.submit} disabled={busy}>
          {busy ? t('auth.loggingIn') : t('auth.login')}
        </button>
        {/* OAuth Google: CHƯA VẼ (FE-5 Q2 giữ Google, bố cục nút chờ bản vẽ).
            Khi có bản vẽ: đường kẻ "hoặc" + nút viền gọi signIn('google', {callbackUrl}). */}
        <div style={authStyles.footRow}>
          <Link href="/forgot-password" style={authStyles.linkMuted}>
            {t('auth.forgotPassword')}
          </Link>
          <Link href={registerHref} style={authStyles.linkStrong}>
            {t('auth.createAccount')}
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
