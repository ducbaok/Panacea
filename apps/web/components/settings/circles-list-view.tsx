'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  CreateCircleDocument,
  type CreateCircleMutation,
  type CreateCircleMutationVariables,
  MyCirclesDocument,
  type MyCirclesQuery,
  type MyCirclesQueryVariables,
} from '@/lib/gql/graphql';
import { circleErrorKey, rawErrorMessage } from '@/lib/errors/circle-error';
import { circleMeta } from '@/lib/visibility';
import { useT } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n/translate';
import { useToast } from '@/components/ui/toast';
import {
  backLinkStyle,
  cardStyle,
  inputStyle,
  outlineBtn,
  primaryBtn,
  sectionLabelStyle,
} from '@/components/settings/circle-ui';

/**
 * XH-CIRCLES · danh sách — 3 trong 5 trạng thái của bản vẽ sống ở màn này:
 * `list` · `empty` · `error` (chạm trần 20 vòng). Hai trạng thái còn lại
 * (`detail`, `emptyMembers`) ở màn chi tiết.
 *
 * ⚠️ VÒNG AD-HOC KHÔNG BAO GIỜ hiện ở đây (`includeAdHoc: false`) — XH-QĐ-5 +
 * QĐ-22. Chúng không có tên, sinh ra từ "Chọn người tại chỗ" của màn tạo pin,
 * và vẫn ăn vào trần 20 vòng; nghĩa là người dùng có thể chạm trần mà đếm trên
 * màn này chỉ thấy ít hơn. Đó là lý do chuỗi lỗi trần nói rõ "tính cả vòng
 * tại chỗ" thay vì chỉ "bạn đã có 20 vòng".
 */
export function CirclesListView() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();

  const { data, loading, error, refetch } = useQuery<MyCirclesQuery, MyCirclesQueryVariables>(
    MyCirclesDocument,
    { variables: { includeAdHoc: false }, fetchPolicy: 'cache-and-network' },
  );
  const [createCircle, { loading: creating }] = useMutation<
    CreateCircleMutation,
    CreateCircleMutationVariables
  >(CreateCircleDocument);

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [rank, setRank] = useState('');
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const circles = data?.myCircles ?? [];

  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setErrorKey(null);
    const parsedRank = rank.trim() === '' ? null : Number(rank);
    try {
      const res = await createCircle({
        variables: {
          input: {
            name: trimmed,
            rank: parsedRank != null && Number.isFinite(parsedRank) ? parsedRank : null,
          },
        },
      });
      setFormOpen(false);
      setName('');
      setRank('');
      await refetch();
      toast({ message: t('circles.created', { name: res.data?.createCircle.name ?? trimmed }) });
    } catch (err) {
      setErrorKey(circleErrorKey(rawErrorMessage(err)) ?? 'errors.circle.maxCircles');
    }
  }

  return (
    <div style={{ padding: '24px 16px 40px' }} data-screen="XH-CIRCLES" data-state={circles.length === 0 && !loading ? 'empty' : 'list'}>
      <button type="button" onClick={() => router.push('/settings')} style={backLinkStyle}>
        ← {t('settings.title')}
      </button>
      <h1
        style={{
          fontFamily: "'Varela Round', sans-serif",
          fontSize: 24,
          margin: '0 0 4px',
          color: 'var(--color-foreground)',
        }}
      >
        {t('circles.title')}
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--color-muted)', margin: '0 0 18px', maxWidth: 640 }}>
        {t('circles.subtitle')}
      </p>

      <div style={{ maxWidth: 640 }}>
        {errorKey && (
          <div role="alert" data-state="error" style={errorBanner}>
            {t(errorKey)}
          </div>
        )}

        {error && !data ? (
          <div style={{ ...cardStyle, padding: '48px 20px', textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{t('circles.loadFailed')}</div>
            <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>
              {t('common.checkNetwork')}
            </div>
          </div>
        ) : loading && circles.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-muted)', fontSize: 14 }}>
            {t('common.loading')}
          </div>
        ) : circles.length === 0 && !formOpen ? (
          <div style={{ ...cardStyle, padding: '56px 24px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 20 }}>
              {t('circles.emptyListTitle')}
            </div>
            <div
              style={{
                fontSize: 13.5,
                color: 'var(--color-muted)',
                marginTop: 8,
                lineHeight: 1.6,
                maxWidth: 420,
                margin: '8px auto 0',
              }}
            >
              {t('circles.emptyListBody')}
            </div>
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              style={{ ...primaryBtn, marginTop: 18 }}
            >
              {t('circles.createFirst')}
            </button>
          </div>
        ) : (
          <div style={{ ...cardStyle, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{t('circles.yourCircles')}</div>
              <button
                type="button"
                onClick={() => setFormOpen((v) => !v)}
                data-testid="new-circle"
                style={{ ...primaryBtn, padding: '9px 16px', fontSize: 12.5 }}
              >
                {t('circles.newCircle')}
              </button>
            </div>

            {formOpen && (
              <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={sectionLabelStyle}>
                  {t('circles.namePrompt')}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('circles.namePlaceholder')}
                    data-testid="circle-name"
                    style={inputStyle}
                  />
                </label>
                <label style={sectionLabelStyle}>
                  {t('circles.rankPrompt')}
                  <input
                    value={rank}
                    onChange={(e) => setRank(e.target.value.replace(/[^0-9]/g, ''))}
                    inputMode="numeric"
                    placeholder={t('circles.rankPlaceholder')}
                    style={inputStyle}
                  />
                </label>
                <div style={{ display: 'flex', gap: 9 }}>
                  <button
                    type="button"
                    onClick={() => void onCreate()}
                    disabled={name.trim() === '' || creating}
                    data-testid="circle-create"
                    style={{
                      ...primaryBtn,
                      opacity: name.trim() === '' || creating ? 0.5 : 1,
                      cursor: name.trim() === '' || creating ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {creating ? t('common.saving') : t('circles.createCircle')}
                  </button>
                  <button type="button" onClick={() => setFormOpen(false)} style={outlineBtn}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {circles.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => router.push(`/settings/circles/${c.id}`)}
                  data-testid="circle-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: 13,
                    borderRadius: 14,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface-muted)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                    color: 'var(--color-foreground)',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 2 }}>
                      {circleMeta(t, c, { showNoRank: true })}
                    </div>
                  </div>
                  <span style={{ color: 'var(--color-muted)' }}>›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            fontSize: 11.5,
            color: 'var(--color-muted)',
            lineHeight: 1.6,
            marginTop: 14,
          }}
        >
          {t('circles.capNote')}
        </div>
      </div>
    </div>
  );
}

const errorBanner: React.CSSProperties = {
  marginBottom: 14,
  padding: '12px 15px',
  borderRadius: 14,
  background: 'var(--color-surface-muted)',
  border: '1px solid var(--color-danger)',
  color: 'var(--color-danger)',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.55,
};
