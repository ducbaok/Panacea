'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { authStyles, AuthHeader } from '@/components/auth/auth-ui';

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
      ? 'Mật khẩu phải có ít nhất 8 ký tự.'
      : error?.kind === 'name'
        ? 'Tên hiển thị cần ít nhất 2 ký tự.'
        : error?.kind === 'email-taken'
          ? 'Email này đã được sử dụng.'
          : error?.kind === 'invalid'
            ? 'Thông tin chưa hợp lệ, kiểm tra lại.'
            : error?.kind === 'network'
              ? 'Không kết nối được máy chủ. Thử lại sau.'
              : null;

  const loginHref =
    callbackUrl && callbackUrl !== '/'
      ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : '/login';

  return (
    <div style={authStyles.column}>
      <AuthHeader subtitle="Tạo tài khoản mới" />
      <form style={authStyles.card} onSubmit={onSubmit} noValidate>
        <label style={authStyles.label}>
          Tên hiển thị
          <input
            type="text"
            autoComplete="name"
            placeholder="Tên của bạn"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={authStyles.input}
          />
        </label>
        <label style={authStyles.label}>
          Email
          <input
            type="email"
            autoComplete="email"
            placeholder="ban@vidu.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={authStyles.input}
          />
        </label>
        <label style={authStyles.label}>
          Mật khẩu
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Nhập mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={authStyles.input}
          />
        </label>
        <div style={authStyles.hint}>Mật khẩu tối thiểu 8 ký tự, kiểm tra ngay lúc gõ.</div>
        {errorText && <div style={authStyles.errorBox}>{errorText}</div>}
        <button type="submit" style={busy ? authStyles.submitBusy : authStyles.submit} disabled={busy}>
          {busy ? 'Đang tạo tài khoản…' : 'Đăng ký'}
        </button>
        {/* OAuth Google: CHƯA VẼ (Q2) — nút chờ bản vẽ, xem login-form.tsx. */}
        <div style={authStyles.footRow}>
          <span />
          <Link href={loginHref} style={authStyles.linkStrong}>
            Đã có tài khoản
          </Link>
        </div>
      </form>
      <div style={authStyles.backRow}>
        <Link href="/" style={authStyles.linkMuted}>
          ← Quay lại lưới pin
        </Link>
      </div>
    </div>
  );
}
