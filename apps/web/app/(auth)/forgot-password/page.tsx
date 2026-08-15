'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authStyles, AuthHeader } from '@/components/auth/auth-ui';

/**
 * A3 — Quên mật khẩu. 5 trạng thái (mockup `view=forgot`):
 *   idle · invalid · sending · sent · neterr
 *
 * 🔴 KHÔNG có trạng thái "email không tồn tại" (§4.5): backend LUÔN 204 kể cả
 * email bịa ra ⇒ một thông điệp duy nhất cho cả hai. Chữ chép đúng mockup.
 */
type Stage = 'idle' | 'invalid' | 'sending' | 'sent' | 'neterr';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [stage, setStage] = useState<Stage>('idle');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (stage === 'sending') return;
    if (!EMAIL_RE.test(email.trim())) {
      setStage('invalid');
      return;
    }
    setStage('sending');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.ok) setStage('sent');
      else if (data.reason === 'network') setStage('neterr');
      else setStage('invalid');
    } catch {
      setStage('neterr');
    }
  }

  const subtitle = stage === 'sent' ? 'Kiểm tra hộp thư của bạn.' : 'Nhập email, chúng tôi sẽ gửi liên kết đặt lại.';

  return (
    <div style={authStyles.column}>
      <AuthHeader subtitle={subtitle} />
      {stage === 'sent' ? (
        <div style={authStyles.card}>
          <div style={authStyles.noteBox}>
            Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại. Liên kết có hiệu lực trong 1 giờ.
          </div>
          <button
            type="button"
            style={authStyles.submit}
            onClick={() => {
              setEmail('');
              setStage('idle');
            }}
          >
            Dùng email khác
          </button>
        </div>
      ) : (
        <form style={authStyles.card} onSubmit={onSubmit} noValidate>
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
          {stage === 'invalid' && <div style={authStyles.errorBox}>Email không hợp lệ.</div>}
          {stage === 'neterr' && (
            <div style={authStyles.errorBox}>Không kết nối được máy chủ. Thử lại sau.</div>
          )}
          <button
            type="submit"
            style={stage === 'sending' ? authStyles.submitBusy : authStyles.submit}
            disabled={stage === 'sending'}
          >
            {stage === 'sending' ? 'Đang gửi…' : stage === 'neterr' ? 'Thử lại' : 'Gửi liên kết đặt lại'}
          </button>
        </form>
      )}
      <div style={authStyles.backRow}>
        <Link href="/login" style={authStyles.linkMuted}>
          ← Quay lại đăng nhập
        </Link>
      </div>
    </div>
  );
}
