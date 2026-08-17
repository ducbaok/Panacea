'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useQuery, useMutation } from '@apollo/client/react';
import {
  MeDocument,
  type MeQuery,
  UpdateProfileDocument,
  type UpdateProfileMutation,
  type UpdateProfileMutationVariables,
  DeleteAccountDocument,
  type DeleteAccountMutation,
  BlockedUsersDocument,
  type BlockedUsersQuery,
} from '@/lib/gql/graphql';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAvatarUpload } from '@/components/profile/use-avatar-upload';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatCount } from '@/lib/format';

/**
 * C2 — Cài đặt (FE-6). Route đã được `proxy.ts` (matcher `/settings/:path*`) bảo
 * vệ ⇒ khách bị đẩy sang /login.
 *
 * Bám bản vẽ v2 (view=settings): 4 khối — Hồ sơ · Giao diện · Tài khoản (Người
 * đã chặn + Đăng xuất) · Xoá tài khoản. Chữ chép nguyên văn từ mockup (§9).
 *
 * ⚠️ Bản vẽ chỉ vẽ 2 ô (Tên hiển thị + Tiểu sử), KHÔNG vẽ nút Lưu, không có ô
 * username/website. Giữ đúng phạm vi đó; thêm nút "Lưu" là phần TỐI THIỂU để nối
 * updateProfile (bản vẽ để trống hành vi). Đổi username (1 lần/30 ngày) không có
 * ô trong bản vẽ nên không dựng ở đợt này.
 */
export default function SettingsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const avatarUpload = useAvatarUpload();
  const meQuery = useQuery<MeQuery>(MeDocument);
  const blockedQuery = useQuery<BlockedUsersQuery>(BlockedUsersDocument, { variables: { first: 50 } });
  const [updateProfile, { loading: saving }] = useMutation<UpdateProfileMutation, UpdateProfileMutationVariables>(UpdateProfileDocument);
  const [deleteAccount] = useMutation<DeleteAccountMutation>(DeleteAccountDocument);

  const me = meQuery.data?.me;
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');

  // Điền sẵn MỘT lần khi me về (dep theo id ⇒ không đè khi user đang gõ).
  useEffect(() => {
    if (me) {
      setName(me.name ?? '');
      setBio(me.bio ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  const dirty = !!me && (name !== (me.name ?? '') || bio !== (me.bio ?? ''));

  const blockedCount = blockedQuery.data?.blockedUsers.items.length ?? 0;
  const blockedMore = blockedQuery.data?.blockedUsers.pageInfo.hasNextPage ?? false;
  const blockedLabel = blockedCount > 0 ? `${formatCount(blockedCount)}${blockedMore ? '+' : ''} người` : '';

  async function onSave() {
    try {
      await updateProfile({ variables: { input: { name, bio } } });
      await meQuery.refetch();
      toast({ message: 'Đã lưu hồ sơ' });
    } catch {
      toast({ message: 'Không lưu được, thử lại sau.' });
    }
  }

  async function onDelete() {
    const step1 = await confirm({
      title: 'Xoá tài khoản?',
      body: 'Toàn bộ pin, board và bình luận của bạn sẽ không còn hiển thị. Hành động này không thể hoàn tác.',
      yesLabel: 'Tiếp tục',
      danger: true,
    });
    if (!step1) return;
    const step2 = await confirm({
      title: 'Xác nhận lần cuối',
      body: 'Bạn chắc chắn muốn xoá tài khoản? Bạn sẽ bị đăng xuất ngay.',
      yesLabel: 'Xoá vĩnh viễn',
      danger: true,
    });
    if (!step2) return;
    try {
      await deleteAccount();
      await signOut({ callbackUrl: '/' });
    } catch {
      toast({ message: 'Không xoá được, thử lại sau.' });
    }
  }

  return (
    <div style={{ padding: '24px 16px 40px' }}>
      <h1 style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 24, margin: '0 0 20px', color: 'var(--color-foreground)' }}>
        Cài đặt
      </h1>
      <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Hồ sơ */}
        <Card>
          <CardTitle>Hồ sơ</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Đổi ảnh đại diện (FE-10, bản vẽ C2): avatar preview 60×60 + nút có
                icon camera + hint. Cùng luồng với nút camera ở C1a — một hook
                `useAvatarUpload`, chỉ gửi { avatarUrl } (§4.9).
                ⚠️ Hint 200×200 là lời khuyên UI: backend KHÔNG kiểm vuông/min-size. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {me?.avatarUrl ? (
                <img
                  src={me.avatarUrl}
                  alt=""
                  style={{ width: 60, height: 60, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
                />
              ) : (
                <div
                  aria-hidden
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: '50%',
                    background: 'var(--color-primary)',
                    color: 'var(--color-primary-foreground)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 22,
                    flex: 'none',
                  }}
                >
                  {(me?.name ?? me?.username ?? '?').trim().charAt(0).toUpperCase() || '?'}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <input {...avatarUpload.inputProps} />
                <button
                  type="button"
                  onClick={avatarUpload.pick}
                  disabled={avatarUpload.phase === 'working'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 16px',
                    borderRadius: 999,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-foreground)',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: avatarUpload.phase === 'working' ? 'wait' : 'pointer',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l.9-1.6a1 1 0 0 1 .87-.5h5.06a1 1 0 0 1 .87.5L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                  {avatarUpload.phase === 'working' ? 'Đang tải ảnh…' : 'Đổi ảnh đại diện'}
                </button>
                <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 6 }}>
                  Ảnh vuông, tối thiểu 200×200.
                </div>
              </div>
            </div>

            <Field label="Tên hiển thị">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Tiểu sử">
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </Field>
            <div>
              <button
                type="button"
                onClick={onSave}
                disabled={!dirty || saving}
                style={{
                  padding: '10px 20px',
                  borderRadius: 999,
                  border: 'none',
                  background: 'var(--color-primary)',
                  color: 'var(--color-primary-foreground)',
                  fontWeight: 700,
                  fontSize: 13.5,
                  cursor: !dirty || saving ? 'default' : 'pointer',
                  opacity: !dirty || saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Đang lưu…' : 'Lưu'}
              </button>
            </div>
          </div>
        </Card>

        {/* Giao diện */}
        <Card>
          <CardTitle noMargin>Giao diện</CardTitle>
          <div style={{ fontSize: 13, color: 'var(--color-muted)', margin: '6px 0 14px' }}>
            Ba trạng thái. “Theo hệ thống” tiếp tục nghe theo cài đặt máy.
          </div>
          <ThemeToggle />
        </Card>

        {/* Tài khoản */}
        <Card>
          <CardTitle noMargin>Tài khoản</CardTitle>
          <div style={{ fontSize: 13, color: 'var(--color-muted)', margin: '6px 0 14px' }}>
            Quản lý người bạn đã chặn và kết thúc phiên đăng nhập.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <button
              type="button"
              onClick={() => router.push('/settings/blocked')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 15px',
                borderRadius: 14,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface-muted)',
                color: 'var(--color-foreground)',
                fontWeight: 600,
                fontSize: 13.5,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ flex: 1 }}>Người đã chặn</span>
              {blockedLabel && <span style={{ color: 'var(--color-muted)', fontSize: 13 }}>{blockedLabel}</span>}
              <span style={{ color: 'var(--color-muted)' }}>›</span>
            </button>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/' })}
              style={{
                alignSelf: 'flex-start',
                padding: '10px 18px',
                borderRadius: 999,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-foreground)',
                fontWeight: 600,
                fontSize: 13.5,
                cursor: 'pointer',
              }}
            >
              Đăng xuất
            </button>
          </div>
        </Card>

        {/* Xoá tài khoản */}
        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: 'var(--color-danger)' }}>Xoá tài khoản</div>
          <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14 }}>
            Xác nhận hai bước. Hành động không thể hoàn tác.
          </div>
          <button
            type="button"
            onClick={onDelete}
            style={{
              padding: '10px 18px',
              borderRadius: 999,
              border: '1px solid var(--color-danger)',
              background: 'none',
              color: 'var(--color-danger)',
              fontWeight: 600,
              fontSize: 13.5,
              cursor: 'pointer',
            }}
          >
            Xoá tài khoản
          </button>
        </Card>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '11px 14px',
  borderRadius: 12,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-muted)',
  color: 'var(--color-foreground)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 18, padding: 22 }}>
      {children}
    </div>
  );
}

function CardTitle({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return <div style={{ fontWeight: 700, fontSize: 15, marginBottom: noMargin ? 0 : 14, color: 'var(--color-foreground)' }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--color-muted)' }}>
      {label}
      {children}
    </label>
  );
}
