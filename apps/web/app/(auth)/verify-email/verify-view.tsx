'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { authStyles, AuthHeader } from '@/components/auth/auth-ui';

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
        title="Thiếu mã xác thực"
        body="URL không có tham số token."
        note="Liên kết không hợp lệ. Hãy yêu cầu liên kết mới."
      />
    );
  }

  if (stage === 'wait') {
    return (
      <Frame
        glyph="✉"
        title="Xác thực email của bạn"
        body="Bấm nút bên dưới để hoàn tất. Màn không tự chạy, để trình đọc mail không tiêu mất liên kết."
        primary={{ label: 'Xác thực email', onClick: doVerify }}
      />
    );
  }

  if (stage === 'loading') {
    return <Frame spinner title="Đang xác thực email…" body="Chờ một chút." />;
  }

  if (stage === 'ok') {
    return (
      <Frame
        glyph="✓"
        tone="success"
        note="Email đã được xác thực."
        title="Xong rồi"
        body="Tài khoản của bạn đã sẵn sàng."
        primaryLink={{ label: 'Về trang chủ', href: '/' }}
      />
    );
  }

  if (stage === 'neterr') {
    return (
      <Frame
        glyph="!"
        tone="danger"
        note="Không kết nối được máy chủ. Thử lại sau."
        title="Không kết nối được"
        body="Kiểm tra mạng rồi thử lại."
        primary={{ label: 'Thử lại', onClick: doVerify }}
      />
    );
  }

  if (stage === 'resending') {
    return (
      <Frame
        glyph="✉"
        title="Liên kết đã hết hạn"
        body="Đang gửi email xác thực mới."
        primary={{ label: 'Đang gửi…', onClick: () => {}, disabled: true }}
      />
    );
  }

  if (stage === 'resent') {
    const waiting = cooldown > 0;
    return (
      <Frame
        glyph="✓"
        tone="success"
        note="Đã gửi email mới. Kiểm tra hộp thư."
        title="Đã gửi lại"
        body="Chưa thấy email? Chờ hết 60 giây rồi gửi tiếp."
        primary={{
          label: waiting ? `Gửi lại sau ${cooldown} giây` : 'Gửi lại email',
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
        note="Liên kết đã hết hạn."
        title="Liên kết đã hết hạn"
        body="Liên kết xác thực có hiệu lực trong 1 giờ."
        primary={{ label: 'Gửi lại email', onClick: doResend }}
      />
    );
  }

  // invalid / malformed — §4.4: nút gửi lại CHỈ khi đang đăng nhập.
  const invalidBody =
    stage === 'malformed'
      ? 'Mã xác thực không đọc được. Hãy mở liên kết mới nhất trong hộp thư.'
      : 'Hãy mở liên kết mới nhất trong hộp thư.';
  return (
    <Frame
      glyph="!"
      tone="danger"
      note="Liên kết không hợp lệ."
      title="Không dùng được liên kết này"
      body={invalidBody}
      primary={loggedIn ? { label: 'Gửi lại email', onClick: doResend } : undefined}
      secondaryLink={loggedIn ? undefined : { label: 'Đăng nhập rồi thử lại', href: '/login' }}
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
  const markColor =
    tone === 'success'
      ? 'var(--color-success)'
      : tone === 'danger'
        ? 'var(--color-danger)'
        : 'var(--color-primary-strong)';
  return (
    <div style={authStyles.column}>
      <AuthHeader subtitle="Xác minh email" />
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
          ← Quay lại đăng nhập
        </Link>
      </div>
    </div>
  );
}
