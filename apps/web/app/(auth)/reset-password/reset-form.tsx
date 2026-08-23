'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authStyles, AuthHeader } from '@/components/auth/auth-ui';
import { useT } from '@/lib/i18n/provider';

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
  const t = useT();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [stage, setStage] = useState<Stage>('idle');

  // notoken: vào thẳng /reset-password không có ?token=
  if (!token) {
    return (
      <div style={authStyles.column}>
        <AuthHeader subtitle={t('auth.resetSubtitle')} />
        <div style={authStyles.card}>
          <div style={authStyles.errorBox}>{t('auth.resetInvalidLink')}</div>
          <Link href="/forgot-password" style={{ ...authStyles.submit, textAlign: 'center' }}>
            {t('auth.requestNewLink')}
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
        <AuthHeader subtitle={t('auth.resetDoneSubtitle')} />
        <div style={authStyles.card}>
          <div style={authStyles.noteBox}>{t('auth.resetDoneNote')}</div>
          <Link href="/login" style={{ ...authStyles.submit, textAlign: 'center' }}>
            {t('auth.login')}
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
        <AuthHeader subtitle={t('auth.resetSubtitle')} />
        <div style={authStyles.card}>
          <div style={authStyles.errorBox}>
            {isExpired ? t('auth.linkExpired') : t('auth.linkInvalid')}
          </div>
          {isExpired && (
            <Link href="/forgot-password" style={{ ...authStyles.submit, textAlign: 'center' }}>
              {t('auth.sendNewLink')}
            </Link>
          )}
        </div>
        <BackToLogin />
      </div>
    );
  }

  return (
    <div style={authStyles.column}>
      <AuthHeader subtitle={t('auth.chooseNewPassword')} />
      <form style={authStyles.card} onSubmit={onSubmit} noValidate>
        <label style={authStyles.label}>
          {t('auth.newPassword')}
          <input
            type="password"
            autoComplete="new-password"
            placeholder={t('auth.newPasswordPlaceholder')}
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            style={authStyles.input}
          />
        </label>
        <label style={authStyles.label}>
          {t('auth.repeatPassword')}
          <input
            type="password"
            autoComplete="new-password"
            placeholder={t('auth.repeatPasswordPlaceholder')}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            style={authStyles.input}
          />
        </label>
        <div style={authStyles.hint}>{t('auth.min8Hint')}</div>
        {stage === 'short' && <div style={authStyles.errorBox}>{t('auth.errPasswordShort')}</div>}
        {stage === 'mismatch' && <div style={authStyles.errorBox}>{t('auth.errPasswordMismatch')}</div>}
        {stage === 'neterr' && <div style={authStyles.errorBox}>{t('auth.errNetwork')}</div>}
        <button
          type="submit"
          style={stage === 'sending' ? authStyles.submitBusy : authStyles.submit}
          disabled={stage === 'sending'}
        >
          {stage === 'sending'
            ? t('auth.sending')
            : stage === 'neterr'
              ? t('common.retry')
              : t('auth.resetSubtitle')}
        </button>
      </form>
      <BackToLogin />
    </div>
  );
}

function BackToLogin() {
  const t = useT();
  return (
    <div style={authStyles.backRow}>
      <Link href="/login" style={authStyles.linkMuted}>
        ← {t('auth.backToLogin')}
      </Link>
    </div>
  );
}
