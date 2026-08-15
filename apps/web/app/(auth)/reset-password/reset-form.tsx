'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authStyles, AuthHeader } from '@/components/auth/auth-ui';

/**
 * A4 — Đặt lại mật khẩu. 9 trạng thái (mockup `view=reset`):
 *   notoken · idle · short · mismatch · sending · done · invalid · expired · neterr
 *
 * QĐ-2: có ô "Nhập lại mật khẩu" — kiểm CLIENT thuần tuý, KHÔNG gửi lên API
 * (backend chỉ nhận một trường `password`). `short` và `mismatch` chặn tại client
 * ⇒ không phát request nào (T2.7c/d).
 *
 * §3.1b (hướng C): chuỗi `done` đã SỬA — đổi mật khẩu nay thu hồi mọi phiên khác,
 * nên báo "đã đăng xuất khỏi các thiết bị khác"; BỎ dòng "khoá 15 phút vẫn còn"
 * (hướng C gỡ khoá khi đổi mật khẩu thành công).
 */
type Stage = 'idle' | 'short' | 'mismatch' | 'sending' | 'done' | 'invalid' | 'expired' | 'neterr';

export function ResetForm({ token }: { token: string | null }) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [stage, setStage] = useState<Stage>('idle');

  // notoken: vào thẳng /reset-password không có ?token=
  if (!token) {
    return (
      <div style={authStyles.column}>
        <AuthHeader subtitle="Đặt lại mật khẩu" />
        <div style={authStyles.card}>
          <div style={authStyles.errorBox}>Liên kết không hợp lệ. Hãy yêu cầu liên kết mới.</div>
          <Link href="/forgot-password" style={{ ...authStyles.submit, textAlign: 'center' }}>
            Yêu cầu liên kết mới
          </Link>
        </div>
        <BackToLogin />
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (stage === 'sending') return;
    if (pw1.length < 8) {
      setStage('short');
      return;
    }
    if (pw1 !== pw2) {
      setStage('mismatch');
      return;
    }
    setStage('sending');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: pw1 }),
      });
      const data = await res.json();
      if (data.ok) setStage('done');
      else if (data.reason === 'expired') setStage('expired');
      else if (data.reason === 'network') setStage('neterr');
      else setStage('invalid');
    } catch {
      setStage('neterr');
    }
  }

  // done — đổi xong, KHÔNG tự đăng nhập (backend trả 204, không phát token).
  if (stage === 'done') {
    return (
      <div style={authStyles.column}>
        <AuthHeader subtitle="Mật khẩu đã được thay." />
        <div style={authStyles.card}>
          <div style={authStyles.noteBox}>
            Đã đổi mật khẩu. Bạn đã được đăng xuất khỏi các thiết bị khác.
          </div>
          <Link href="/login" style={{ ...authStyles.submit, textAlign: 'center' }}>
            Đăng nhập
          </Link>
        </div>
        <BackToLogin />
      </div>
    );
  }

  // invalid / expired — token hỏng hoặc hết hạn (backend phân biệt được).
  if (stage === 'invalid' || stage === 'expired') {
    const isExpired = stage === 'expired';
    return (
      <div style={authStyles.column}>
        <AuthHeader subtitle="Đặt lại mật khẩu" />
        <div style={authStyles.card}>
          <div style={authStyles.errorBox}>{isExpired ? 'Liên kết đã hết hạn.' : 'Liên kết không hợp lệ.'}</div>
          {isExpired && (
            <Link href="/forgot-password" style={{ ...authStyles.submit, textAlign: 'center' }}>
              Gửi liên kết mới
            </Link>
          )}
        </div>
        <BackToLogin />
      </div>
    );
  }

  return (
    <div style={authStyles.column}>
      <AuthHeader subtitle="Chọn mật khẩu mới cho tài khoản." />
      <form style={authStyles.card} onSubmit={onSubmit} noValidate>
        <label style={authStyles.label}>
          Mật khẩu mới
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Tối thiểu 8 ký tự"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            style={authStyles.input}
          />
        </label>
        <label style={authStyles.label}>
          Nhập lại mật khẩu
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Nhập lại mật khẩu mới"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            style={authStyles.input}
          />
        </label>
        <div style={authStyles.hint}>Tối thiểu 8 ký tự.</div>
        {stage === 'short' && <div style={authStyles.errorBox}>Mật khẩu phải có ít nhất 8 ký tự.</div>}
        {stage === 'mismatch' && <div style={authStyles.errorBox}>Hai mật khẩu chưa khớp.</div>}
        {stage === 'neterr' && <div style={authStyles.errorBox}>Không kết nối được máy chủ. Thử lại sau.</div>}
        <button
          type="submit"
          style={stage === 'sending' ? authStyles.submitBusy : authStyles.submit}
          disabled={stage === 'sending'}
        >
          {stage === 'sending' ? 'Đang gửi…' : stage === 'neterr' ? 'Thử lại' : 'Đặt lại mật khẩu'}
        </button>
      </form>
      <BackToLogin />
    </div>
  );
}

function BackToLogin() {
  return (
    <div style={authStyles.backRow}>
      <Link href="/login" style={authStyles.linkMuted}>
        ← Quay lại đăng nhập
      </Link>
    </div>
  );
}
