'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { authStyles, AuthHeader } from '@/components/auth/auth-ui';
import { useT } from '@/lib/i18n/provider';

/**
 * A5 — Xác minh email. 9 trạng thái (mockup `view=verify`):
 *   wait · loading · ok · invalid · malformed · expired · resending · resent · neterr · notoken
 *
 * Khác A1–A4: KHÔNG có form. Mở màn ở `wait` (chờ bấm) — 0 request cho tới khi
 * người dùng bấm "Xác thực email" (§4.2, T2.12 — lá chắn chống prefetch).
 *
 * Nút "Gửi lại email" (§4.4):
 *   • expired      → LUÔN có (token cũ vẫn tra ngược ra chủ nhân, kể cả khách).
 *   • invalid/malformed → CHỈ khi đang đăng nhập (nhận diện bằng phiên); khách
 *     thì không tra ra ai ⇒ dẫn sang /login.
 * Sau khi gửi lại: cooldown 60 giây (đếm trong useEffect — hydration-safe, bẫy #9).
 */
type Stage =
  | 'wait'
  | 'loading'
  | 'ok'
  | 'invalid'
  | 'malformed'
  | 'expired'
  | 'resending'
  | 'resent'
  | 'neterr';

export function VerifyView({ token }: { token: string | null }) {
  const t = useT();
  const { status } = useSession();
  const loggedIn = status === 'authenticated';
  const [stage, setStage] = useState<Stage>('wait');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (stage !== 'resent' || cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [stage, cooldown]);

  async function doVerify() {
    setStage('loading');
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.ok) setStage('ok');
      else if (data.reason === 'expired') setStage('expired');
      else if (data.reason === 'malformed') setStage('malformed');
      else if (data.reason === 'network') setStage('neterr');
      else setStage('invalid');
    } catch {
      setStage('neterr');
    }
  }

  async function doResend() {
    setStage('resending');
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(token ? { token } : {}),
      });
      const data = await res.json();
      if (data.ok || data.reason === 'rate-limited') {
        setStage('resent');
        setCooldown(60);
      } else {
        setStage('neterr');
      }
    } catch {
      setStage('neterr');
    }
  }

  // notoken — vào thẳng không có ?token=
  if (!token) {
    return (
      <Frame
        glyph="!"
        tone="danger"
        title={t('auth.verifyNoTokenTitle')}
        body={t('auth.verifyNoTokenBody')}
        note={t('auth.resetInvalidLink')}
      />
    );
  }

  if (stage === 'wait') {
    return (
      <Frame
        glyph="✉"
        title={t('auth.verifyWaitTitle')}
        body={t('auth.verifyWaitBody')}
        primary={{ label: t('auth.verifyAction'), onClick: doVerify }}
      />
    );
  }

  if (stage === 'loading') {
    return <Frame spinner title={t('auth.verifyLoadingTitle')} body={t('auth.verifyLoadingBody')} />;
  }

  if (stage === 'ok') {
    return (
      <Frame
        glyph="✓"
        tone="success"
        note={t('auth.verifyOkNote')}
        title={t('auth.verifyOkTitle')}
        body={t('auth.verifyOkBody')}
        primaryLink={{ label: t('common.goHome'), href: '/' }}
      />
    );
  }

  if (stage === 'neterr') {
    return (
      <Frame
        glyph="!"
        tone="danger"
        note={t('auth.errNetwork')}
        title={t('auth.verifyNetTitle')}
        body={t('common.checkNetwork')}
        primary={{ label: t('common.retry'), onClick: doVerify }}
      />
    );
  }

  if (stage === 'resending') {
    return (
      <Frame
        glyph="✉"
        title={t('auth.verifyExpiredTitle')}
        body={t('auth.verifyResendingBody')}
        primary={{ label: t('auth.sending'), onClick: () => {}, disabled: true }}
      />
    );
  }

  if (stage === 'resent') {
    const waiting = cooldown > 0;
    return (
      <Frame
        glyph="✓"
        tone="success"
        note={t('auth.verifyResentNote')}
        title={t('auth.verifyResentTitle')}
        body={t('auth.verifyResentBody')}
        primary={{
          label: waiting ? t('auth.verifyResendIn', { sec: cooldown }) : t('auth.verifyResend'),
          onClick: doResend,
          disabled: waiting,
        }}
      />
    );
  }

  if (stage === 'expired') {
    return (
      <Frame
        glyph="!"
        tone="danger"
        note={t('auth.linkExpired')}
        title={t('auth.verifyExpiredTitle')}
        body={t('auth.verifyExpiredBody')}
        primary={{ label: t('auth.verifyResend'), onClick: doResend }}
      />
    );
  }

  // invalid / malformed — §4.4: nút gửi lại CHỈ khi đang đăng nhập.
  const invalidBody =
    stage === 'malformed' ? t('auth.verifyMalformedBody') : t('auth.verifyInvalidBody');
  return (
    <Frame
      glyph="!"
      tone="danger"
      note={t('auth.linkInvalid')}
      title={t('auth.verifyBadTitle')}
      body={invalidBody}
      primary={loggedIn ? { label: t('auth.verifyResend'), onClick: doResend } : undefined}
      secondaryLink={loggedIn ? undefined : { label: t('auth.loginAndRetry'), href: '/login' }}
    />
  );
}

// ── Khung thẻ dùng chung cho mọi trạng thái A5 ─────────────────────────────────
type Btn = { label: string; onClick: () => void; disabled?: boolean };
type LinkBtn = { label: string; href: string };

function Frame({
  glyph,
  spinner,
  tone,
  title,
  body,
  note,
  primary,
  primaryLink,
  secondaryLink,
}: {
  glyph?: string;
  spinner?: boolean;
  tone?: 'success' | 'danger';
  title: string;
  body: string;
  note?: string;
  primary?: Btn;
  primaryLink?: LinkBtn;
  secondaryLink?: LinkBtn;
}) {
  const t = useT();
  const markColor =
    tone === 'success'
      ? 'var(--color-success)'
      : tone === 'danger'
        ? 'var(--color-danger)'
        : 'var(--color-primary-strong)';
  return (
    <div style={authStyles.column}>
      <AuthHeader subtitle={t('auth.verifySubtitle')} />
      <div style={{ ...authStyles.card, alignItems: 'center', textAlign: 'center' }}>
        {spinner ? (
          <div
            className="animate-spin"
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: '3px solid var(--color-border)',
              borderTopColor: 'var(--color-primary-strong)',
            }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--color-surface-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              color: markColor,
            }}
          >
            {glyph}
          </div>
        )}
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-foreground)', lineHeight: 1.4 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1.6 }}>{body}</div>
        {note && (
          <div style={{ ...(tone === 'success' ? authStyles.noteBox : authStyles.errorBox), width: '100%' }}>
            {note}
          </div>
        )}
        {primary && (
          <button
            type="button"
            onClick={primary.onClick}
            disabled={primary.disabled}
            style={{ ...(primary.disabled ? authStyles.submitBusy : authStyles.submit), width: '100%' }}
          >
            {primary.label}
          </button>
        )}
        {primaryLink && (
          <Link href={primaryLink.href} style={{ ...authStyles.submit, width: '100%', textAlign: 'center' }}>
            {primaryLink.label}
          </Link>
        )}
        {secondaryLink && (
          <Link href={secondaryLink.href} style={authStyles.linkStrong}>
            {secondaryLink.label}
          </Link>
        )}
      </div>
      <div style={authStyles.backRow}>
        <Link href="/login" style={authStyles.linkMuted}>
          ← {t('auth.backToLogin')}
        </Link>
      </div>
    </div>
  );
}
