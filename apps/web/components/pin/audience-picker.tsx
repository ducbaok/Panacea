'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@apollo/client/react';
import {
  CircleMemberSuggestionsDocument,
  type CircleMemberSuggestionsQuery,
  type CircleMemberSuggestionsQueryVariables,
  CreateAdHocCircleDocument,
  type CreateAdHocCircleMutation,
  type CreateAdHocCircleMutationVariables,
  MeDocument,
  type MeQuery,
  MyCirclesDocument,
  type MyCirclesQuery,
  type MyCirclesQueryVariables,
  SaveAdHocCircleDocument,
  type SaveAdHocCircleMutation,
  type SaveAdHocCircleMutationVariables,
  Visibility,
} from '@/lib/gql/graphql';
import { circleErrorKey, rawErrorMessage } from '@/lib/errors/circle-error';
import {
  audienceName,
  circleDisplayName,
  circleMeta,
  expiryLeftLabel,
  VIS_ICON_PATH,
  VIS_LABEL_KEY,
  VIS_SUB_KEY,
  VISIBILITY_ORDER,
} from '@/lib/visibility';
import { useT } from '@/lib/i18n/provider';
import type { TFunction } from '@/lib/i18n/translate';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

/**
 * XH-AUD — BỘ CHỌN KHÁN GIẢ (bản vẽ `Panacea-v3.1.html`, 8 trạng thái).
 *
 * Đây là bề mặt "chống đăng nhầm" của cả đợt xã hội (PLAN_XAHOI.md §9), nên ba
 * ràng buộc dưới đây là ràng buộc CỨNG, không phải lựa chọn thẩm mỹ:
 *
 *   1. Khán giả hiện ngay CẠNH nút Đăng, không giấu trong menu phụ. Component
 *      này chỉ vẽ khối chọn; nhãn cạnh nút Đăng do màn tạo/sửa pin render bằng
 *      `audienceSummary()` xuất ở cuối file — cùng một hàm, nên hai chỗ không
 *      thể nói khác nhau.
 *   2. Đổi từ vòng riêng → CÔNG KHAI thì HỎI LẠI; chiều ngược lại KHÔNG hỏi.
 *      Hộp thoại dùng `confirm-dialog` sẵn có, chữ chép nguyên văn bản vẽ.
 *   3. Mặc định là PUBLIC và mỗi pin bắt đầu lại từ PUBLIC.
 *
 * 🔴 KHÔNG có "nhớ khán giả lần trước" — XH-QĐ-18 (chốt 24/08/2026) nói rõ v1
 * KHÔNG làm, và bản vẽ ghi thẳng trong ghi chú của màn: "Không nhớ khán giả lần
 * trước — mỗi pin bắt đầu ở PUBLIC". Prompt mở màn của luồng F1 (viết 21/08,
 * TRƯỚC quyết định đó) còn ghi "nhớ-khán-giả về phía riêng tư hơn"; luật
 * "chỉ nhớ về phía riêng tư hơn" ở PLAN_XAHOI §9 là luật để DÀNH cho lúc làm
 * thật, không phải việc của v1. Ai mở lại món này: nhớ về phía riêng tư hơn,
 * không bao giờ tự rơi về công khai.
 *
 * ⚠️ Vòng ad-hoc ẨN HẲN khỏi danh sách vòng (QĐ-22 + XH-QĐ-5): chỉ đi vào qua
 * "+ Chọn người tại chỗ", không tên, không nằm trong /settings/circles.
 */

export type AudienceValue = {
  visibility: Visibility;
  /** Chỉ có nghĩa khi visibility = CIRCLE và người dùng chọn một vòng có sẵn. */
  circleId: string | null;
  /** Chỉ có nghĩa khi visibility = CIRCLE và người dùng chọn người tại chỗ. */
  adHocUserIds: string[];
  /** ISO 8601, hoặc null = không đặt hạn. */
  expiresAt: string | null;
};

export const DEFAULT_AUDIENCE: AudienceValue = {
  visibility: Visibility.Public,
  circleId: null,
  adHocUserIds: [],
  expiresAt: null,
};

/**
 * Khán giả đã đủ dữ liệu để đăng chưa. CIRCLE mà chưa chọn vòng lẫn chưa chọn
 * người ⇒ backend ném 400 ("requires exactly one of…"); khoá nút Đăng ở client
 * để người dùng không phải học điều đó qua một thông báo lỗi.
 */
export function isAudienceComplete(value: AudienceValue): boolean {
  if (value.visibility !== Visibility.Circle) return true;
  return value.circleId != null || value.adHocUserIds.length > 0;
}

/**
 * Đổi sang phần khán giả của `CreatePinInput`/`UpdatePinInput`.
 *
 * 🔴 Backend ném 400 nếu gửi `audienceCircleId`/`audienceUserIds` khi cấp KHÁC
 * CIRCLE (`pins.service.ts` — cố ý ném thay vì bỏ qua im lặng, vì bỏ qua nghĩa
 * là người dùng tưởng đã chọn vòng mà pin đang công khai). Vì thế hàm này chỉ
 * đính hai field đó ở đúng nhánh CIRCLE, và đúng MỘT trong hai.
 */
export function audienceToInput(value: AudienceValue): {
  visibility: Visibility;
  audienceCircleId?: string;
  audienceUserIds?: string[];
  expiresAt?: string;
} {
  const out: {
    visibility: Visibility;
    audienceCircleId?: string;
    audienceUserIds?: string[];
    expiresAt?: string;
  } = { visibility: value.visibility };

  if (value.visibility === Visibility.Circle) {
    if (value.circleId) out.audienceCircleId = value.circleId;
    else if (value.adHocUserIds.length > 0) out.audienceUserIds = value.adHocUserIds;
  }
  if (value.expiresAt) out.expiresAt = value.expiresAt;
  return out;
}

type CircleLite = MyCirclesQuery['myCircles'][number];

/** Nhãn gọn cạnh nút Đăng: "Bạn thân · còn 7 ngày". */
export function audienceSummary(
  t: TFunction,
  value: AudienceValue,
  circles: readonly CircleLite[],
): string {
  let head: string;
  if (value.visibility === Visibility.Circle) {
    const picked = circles.find((c) => c.id === value.circleId);
    head = picked
      ? circleDisplayName(t, picked)
      : value.adHocUserIds.length > 0
        ? t('circles.adHocName', { count: value.adHocUserIds.length })
        : t('circles.visCircle');
  } else {
    head = t(VIS_LABEL_KEY[value.visibility]);
  }
  const left = expiryLeftLabel(t, value.expiresAt);
  return left ? `${head} · ${left}` : head;
}

/** Danh sách vòng CHỌN ĐƯỢC (ad-hoc bị ẩn — QĐ-22). Dùng chung cho nhãn tóm tắt. */
export function useMyCircles(skip = false) {
  const { data, loading, error, refetch } = useQuery<MyCirclesQuery, MyCirclesQueryVariables>(
    MyCirclesDocument,
    { variables: { includeAdHoc: false }, skip, fetchPolicy: 'cache-and-network' },
  );
  return {
    circles: data?.myCircles ?? [],
    loading,
    /**
     * ĐÃ CÓ CÂU TRẢ LỜI hay chưa — KHÁC `!loading` (25/08/2026, đo trên trình duyệt).
     *
     * Với `fetchPolicy: 'cache-and-network'` và cache rỗng, `useQuery` đi qua
     * một nhịp `loading === false` trong khi `data` vẫn `undefined`. Bên gọi
     * nào lấy `!loading` làm dấu hiệu "danh sách vòng đã đầy đủ" sẽ đọc ra
     * **0 vòng** ở đúng nhịp đó — `create-pin-view.tsx` đã ăn đúng cú này: nó
     * gỡ mất vòng chọn sẵn từ `?circle=` vì tưởng id đó không phải của mình.
     * `loaded` không có nhịp trung gian: `undefined` cho tới khi có mảng thật.
     */
    loaded: data !== undefined,
    error,
    refetch,
  };
}

type ExpiryChoice = 'none' | '24h' | '7d' | 'custom';

/**
 * Toán thời gian sống ở NGOÀI component — cố ý.
 *
 * `Date.now()` là hàm không thuần: cùng props/state mà mỗi lần render cho một
 * kết quả khác. Gọi nó trong thân component (kể cả trong một handler khai ở đó)
 * bị `react-hooks` chặn, và chặn ĐÚNG: bản đầu của file này tính `customOk`
 * ngay trong render, nghĩa là một pin đang hợp lệ có thể tự đổi sang "quá khứ"
 * giữa hai lần render mà không có sự kiện nào. Nay mọi mốc thời gian được chốt
 * TẠI LÚC NGƯỜI DÙNG BẤM rồi cất vào state.
 */
function isoFromNow(msAhead: number): string {
  return new Date(Date.now() + msAhead).toISOString();
}

/** ISO nếu mốc tự chọn nằm ở tương lai; null nếu trống/không hợp lệ/đã qua. */
function isoIfFuture(date: string, time: string): string | null {
  if (!date) return null;
  const at = new Date(`${date}T${time || '00:00'}`);
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return null;
  return at.toISOString();
}

/** Suy ngược mốc chọn sẵn từ một ISO có sẵn (màn sửa pin điền lại bộ chọn). */
function initialExpiryChoice(expiresAt: string | null): ExpiryChoice {
  return expiresAt ? 'custom' : 'none';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` theo GIỜ ĐỊA PHƯƠNG — `toISOString()` ở đây sẽ lệch một ngày. */
function localDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localTimeValue(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

type Props = {
  value: AudienceValue;
  onChange: (next: AudienceValue) => void;
  /**
   * Khối "Hạn sống". TẮT ở màn SỬA pin: `updatePin` chỉ ĐẶT/ĐỔI được hạn chứ
   * KHÔNG gỡ được (gỡ hạn là `republishPin`, thuộc màn Kho của luồng F2), nên
   * hiện một chip "Không đặt" ở đó là vẽ ra một nút không làm gì.
   */
  showExpiry?: boolean;
  disabled?: boolean;
};

export function AudiencePicker({ value, onChange, showExpiry = true, disabled }: Props) {
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  // `min` của ô ngày là "hôm nay". Chốt MỘT lần lúc mount thay vì đọc đồng hồ
  // mỗi render — cùng lý do với `isoFromNow`; qua nửa đêm mà form vẫn mở thì
  // sàn lệch một ngày, còn chốt chặn thật vẫn là `isoIfFuture`.
  const [todayValue] = useState(() => localDateValue(new Date()));
  const [adHocOpen, setAdHocOpen] = useState(false);
  // Ô tên nằm NGAY TRONG panel thay vì `window.prompt`: hộp thoại gốc của trình
  // duyệt khoá cả trang, không kiểm được bằng trình duyệt tự động, và ở một số
  // ngữ cảnh bị chặn thẳng.
  const [adHocName, setAdHocName] = useState('');
  const [errorKey, setErrorKey] = useState<ReturnType<typeof circleErrorKey>>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { circles, loading: circlesLoading } = useMyCircles();
  const meQuery = useQuery<MeQuery>(MeDocument);
  const followerCount = meQuery.data?.me?.followerCount ?? null;

  const suggestions = useQuery<CircleMemberSuggestionsQuery, CircleMemberSuggestionsQueryVariables>(
    CircleMemberSuggestionsDocument,
    { variables: { first: 10 }, skip: !adHocOpen },
  );

  const [createAdHoc] = useMutation<CreateAdHocCircleMutation, CreateAdHocCircleMutationVariables>(
    CreateAdHocCircleDocument,
  );
  const [saveAdHoc] = useMutation<SaveAdHocCircleMutation, SaveAdHocCircleMutationVariables>(
    SaveAdHocCircleDocument,
    { refetchQueries: [{ query: MyCirclesDocument, variables: { includeAdHoc: false } }] },
  );

  // ── Hạn sống — trạng thái CỤC BỘ, chỉ đẩy ISO đã tính ra ngoài ──
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>(() =>
    initialExpiryChoice(value.expiresAt),
  );
  /**
   * `at` = ISO đã CHỐT lúc bấm (null = chưa hợp lệ). Giữ trong state thay vì
   * tính lại mỗi render — xem docblock của `isoIfFuture`. Giá trị ban đầu lấy
   * thẳng từ pin đang sửa: nó đến từ dữ liệu, không phải từ đồng hồ.
   */
  const [custom, setCustom] = useState<{ date: string; time: string; at: string | null }>(() => ({
    date: value.expiresAt ? localDateValue(new Date(value.expiresAt)) : '',
    time: value.expiresAt ? localTimeValue(new Date(value.expiresAt)) : '',
    at: value.expiresAt ?? null,
  }));

  const pickedCircle = circles.find((c) => c.id === value.circleId) ?? null;
  const pickedCircleName = pickedCircle ? circleDisplayName(t, pickedCircle) : '';

  const emitAudience = useCallback(
    (patch: Partial<AudienceValue>) => onChange({ ...value, ...patch }),
    [onChange, value],
  );

  // Đóng khi bấm ra ngoài — panel là overlay tuyệt đối, không có nền tối riêng.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const customAt = custom.at ? new Date(custom.at) : null;
  const customOk = customAt != null;

  // Mốc chọn sẵn → ISO, chốt TẠI LÚC BẤM: người dùng mở form 10 phút rồi mới
  // bấm "24 giờ" thì mốc phải đếm từ lúc bấm, không phải từ lúc mở.
  const applyExpiryChoice = (choice: ExpiryChoice) => {
    setExpiryChoice(choice);
    if (choice === 'none') return emitAudience({ expiresAt: null });
    if (choice === '24h') return emitAudience({ expiresAt: isoFromNow(24 * 3600_000) });
    if (choice === '7d') return emitAudience({ expiresAt: isoFromNow(7 * 24 * 3600_000) });
    // custom — chưa hợp lệ thì để trống, echo đỏ đã báo lý do.
    emitAudience({ expiresAt: custom.at });
  };

  const applyCustom = (date: string, time: string) => {
    const at = isoIfFuture(date, time);
    setCustom({ date, time, at });
    emitAudience({ expiresAt: at });
  };

  /** Ràng buộc 2 — chỉ chiều RIÊNG → CÔNG KHAI mới hỏi. */
  const setVisibility = async (next: Visibility) => {
    setErrorKey(null);
    if (next === Visibility.Public && value.visibility !== Visibility.Public) {
      const ok = await confirm({
        title: t('circles.confirmPublicTitle'),
        body: t('circles.confirmPublicBody', {
          audience: audienceName(t, value.visibility, pickedCircleName),
        }),
        yesLabel: t('circles.confirmPublicYes'),
      });
      if (!ok) return;
    }
    setAdHocOpen(false);
    onChange({
      ...value,
      visibility: next,
      // Rời khỏi CIRCLE thì phải BỎ hẳn vòng/danh sách người: giữ lại là gửi
      // kèm audienceCircleId ở cấp khác ⇒ backend 400.
      circleId: next === Visibility.Circle ? value.circleId : null,
      adHocUserIds: next === Visibility.Circle ? value.adHocUserIds : [],
    });
  };

  const pickCircle = (id: string) => {
    setErrorKey(null);
    setAdHocOpen(false);
    onChange({ ...value, visibility: Visibility.Circle, circleId: id, adHocUserIds: [] });
  };

  const toggleAdHocUser = (userId: string) => {
    setErrorKey(null);
    const has = value.adHocUserIds.includes(userId);
    onChange({
      ...value,
      visibility: Visibility.Circle,
      circleId: null,
      adHocUserIds: has
        ? value.adHocUserIds.filter((id) => id !== userId)
        : [...value.adHocUserIds, userId],
    });
  };

  /**
   * "Lưu vòng tròn này" — hai bước vì hợp đồng đòi có id trước khi đặt tên
   * được: `createAdHocCircle(userIds)` (tự tái dùng vòng cũ theo `memberHash`,
   * nên bấm hai lần cùng tập người KHÔNG đẻ thêm vòng) rồi `saveAdHocCircle`.
   * Xong thì khán giả chuyển sang trỏ vòng ĐÃ ĐẶT TÊN, không còn là ad-hoc.
   */
  const onSaveAdHoc = async () => {
    const name = adHocName.trim();
    if (value.adHocUserIds.length === 0 || !name) return;
    setErrorKey(null);
    try {
      const created = await createAdHoc({ variables: { input: { userIds: value.adHocUserIds } } });
      const circleId = created.data?.createAdHocCircle.id;
      if (!circleId) throw new Error('createAdHocCircle returned nothing');
      const saved = await saveAdHoc({ variables: { input: { circleId, name } } });
      const savedId = saved.data?.saveAdHocCircle.id ?? circleId;
      setAdHocOpen(false);
      setAdHocName('');
      onChange({ ...value, visibility: Visibility.Circle, circleId: savedId, adHocUserIds: [] });
      toast({ message: t('circles.adhocSaved') });
    } catch (err) {
      setErrorKey(circleErrorKey(rawErrorMessage(err)) ?? 'errors.circle.maxCircles');
    }
  };

  const summary = audienceSummary(t, value, circles);
  const isPublic = value.visibility === Visibility.Public;
  const showCircleRows = value.visibility === Visibility.Circle && !adHocOpen;
  const circlesEmpty = !circlesLoading && circles.length === 0;

  return (
    <div ref={wrapRef} data-screen="XH-AUD" data-visibility={value.visibility} style={{ position: 'relative' }}>
      <label style={fieldLabel} htmlFor="pin-audience">
        {t('circles.audienceLabel')}
      </label>

      <button
        id="pin-audience"
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          width: '100%',
          boxSizing: 'border-box',
          padding: '12px 14px',
          borderRadius: 12,
          border: `1px solid ${isPublic ? 'var(--color-border)' : 'var(--color-primary-strong)'}`,
          background: isPublic ? 'var(--color-surface)' : 'var(--color-primary-soft)',
          color: 'var(--color-foreground)',
          fontSize: 14,
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <VisIcon path={VIS_ICON_PATH[value.visibility]} size={17} />
        <span style={{ flex: 1, minWidth: 0 }}>{summary}</span>
        <span style={{ color: 'var(--color-muted)' }}>▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 70,
            left: 0,
            right: 0,
            marginTop: 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 18,
            boxShadow: 'var(--shadow-hover)',
            padding: 10,
            maxHeight: 440,
            overflowY: 'auto',
          }}
        >
          {VISIBILITY_ORDER.map((v) => {
            const active = value.visibility === v;
            const sub =
              v === Visibility.Followers && followerCount == null
                ? t('circles.visFollowersSubUnknown')
                : t(VIS_SUB_KEY[v], { count: followerCount ?? 0 });
            return (
              <button
                key={v}
                type="button"
                role="option"
                aria-selected={active}
                data-visibility-option={v}
                onClick={() => void setVisibility(v)}
                style={rowStyle(active)}
              >
                <VisIcon path={VIS_ICON_PATH[v]} size={18} style={{ marginTop: 1 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                    {t(VIS_LABEL_KEY[v])}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11.5,
                      color: 'var(--color-muted)',
                      lineHeight: 1.5,
                      marginTop: 2,
                    }}
                  >
                    {sub}
                  </span>
                </span>
                <span style={tickStyle(active)}>✓</span>
              </button>
            );
          })}

          {showCircleRows && !circlesEmpty && (
            <div style={sectionStyle}>
              <div style={sectionHeading}>{t('circles.yourCircles')}</div>
              {circles.map((c) => {
                const active = value.circleId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickCircle(c.id)}
                    style={rowStyle(active)}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                        {circleDisplayName(t, c)}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11.5,
                          color: 'var(--color-muted)',
                          marginTop: 2,
                        }}
                      >
                        {circleMeta(t, c)}
                      </span>
                    </span>
                    <span style={tickStyle(active)}>✓</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setAdHocOpen(true);
                  onChange({ ...value, visibility: Visibility.Circle, circleId: null });
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  marginTop: 4,
                  padding: '11px 12px',
                  borderRadius: 14,
                  border: '1px dashed var(--color-border)',
                  background: 'none',
                  color: 'var(--color-primary-strong)',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                {t('circles.pickPeopleInline')}
              </button>
            </div>
          )}

          {value.visibility === Visibility.Circle && adHocOpen && (
            <div style={sectionStyle}>
              <div style={sectionHeading}>{t('circles.adhocHeading')}</div>
              {(suggestions.data?.circleMemberSuggestions ?? []).map((u) => {
                const active = value.adHocUserIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleAdHocUser(u.id)}
                    style={rowStyle(active)}
                  >
                    <PersonAvatar name={u.name ?? u.username} url={u.avatarUrl} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>
                        {u.name ?? u.username}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11.5,
                          color: 'var(--color-muted)',
                          marginTop: 2,
                        }}
                      >
                        @{u.username}
                      </span>
                    </span>
                    <span style={tickStyle(active)}>✓</span>
                  </button>
                );
              })}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 10,
                  padding: '0 4px',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--color-muted)', flex: 1 }}>
                  {value.adHocUserIds.length > 0
                    ? t('circles.adhocChosen', { count: value.adHocUserIds.length })
                    : t('circles.adhocNone')}
                </span>
                <input
                  type="text"
                  value={adHocName}
                  onChange={(e) => setAdHocName(e.target.value)}
                  placeholder={t('circles.adhocSavePrompt')}
                  data-testid="adhoc-name"
                  style={{
                    flex: '1 1 130px',
                    minWidth: 0,
                    padding: '9px 12px',
                    borderRadius: 11,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface-muted)',
                    color: 'var(--color-foreground)',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  disabled={value.adHocUserIds.length === 0 || adHocName.trim() === ''}
                  onClick={() => void onSaveAdHoc()}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 999,
                    border: 'none',
                    background: 'var(--color-primary)',
                    color: 'var(--color-primary-foreground)',
                    fontWeight: 700,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    cursor:
                      value.adHocUserIds.length === 0 || adHocName.trim() === ''
                        ? 'not-allowed'
                        : 'pointer',
                    opacity:
                      value.adHocUserIds.length === 0 || adHocName.trim() === '' ? 0.45 : 1,
                  }}
                >
                  {t('circles.saveThisCircle')}
                </button>
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--color-muted)',
                  lineHeight: 1.6,
                  marginTop: 9,
                  padding: '0 4px',
                }}
              >
                {t('circles.adhocNote')}
              </div>
            </div>
          )}

          {value.visibility === Visibility.Circle && circlesEmpty && !adHocOpen && (
            <div style={{ padding: '20px 14px', textAlign: 'center' }} data-state="empty">
              <div style={{ fontWeight: 700, fontSize: 14 }}>{t('circles.pickerEmptyTitle')}</div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--color-muted)',
                  marginTop: 6,
                  lineHeight: 1.6,
                }}
              >
                {t('circles.pickerEmptyBody')}
              </div>
              <button
                type="button"
                onClick={() => router.push('/settings/circles')}
                style={{
                  marginTop: 14,
                  padding: '10px 18px',
                  borderRadius: 999,
                  border: 'none',
                  background: 'var(--color-primary)',
                  color: 'var(--color-primary-foreground)',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('circles.createCircle')}
              </button>
            </div>
          )}

          {errorKey && (
            <div role="alert" data-state="error" style={errorBoxStyle}>
              {t(errorKey)}
            </div>
          )}

          {showExpiry && (
            <div
              style={{
                margin: '8px 4px 2px',
                paddingTop: 12,
                borderTop: '1px solid var(--color-border)',
              }}
            >
              <div style={{ ...sectionHeading, marginBottom: 8 }}>{t('circles.expiryHeading')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(
                  [
                    ['none', t('circles.expiryNone')],
                    ['24h', t('circles.expiry24h')],
                    ['7d', t('circles.expiry7d')],
                    ['custom', t('circles.expiryCustom')],
                  ] as const
                ).map(([choice, label]) => (
                  <button
                    key={choice}
                    type="button"
                    data-expiry-option={choice}
                    onClick={() => applyExpiryChoice(choice)}
                    style={segStyle(expiryChoice === choice)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {expiryChoice === 'custom' && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ ...inlineFieldLabel, flex: '1 1 150px' }}>
                      {t('circles.expiryDate')}
                      <input
                        type="date"
                        value={custom.date}
                        min={todayValue}
                        onChange={(e) => applyCustom(e.target.value, custom.time)}
                        style={inlineInput}
                      />
                    </label>
                    <label style={{ ...inlineFieldLabel, flex: '0 1 110px' }}>
                      {t('circles.expiryTime')}
                      <input
                        type="time"
                        value={custom.time}
                        onChange={(e) => applyCustom(custom.date, e.target.value)}
                        style={inlineInput}
                      />
                    </label>
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      lineHeight: 1.6,
                      marginTop: 8,
                      color: customOk ? 'var(--color-muted)' : 'var(--color-danger)',
                    }}
                  >
                    {customOk && customAt
                      ? t('circles.expiryEcho', {
                          time: localTimeValue(customAt),
                          date: `${customAt.getDate()}/${customAt.getMonth() + 1}/${customAt.getFullYear()}`,
                          left: expiryLeftLabel(t, customAt.toISOString()),
                        })
                      : t('circles.expiryPast')}
                  </div>
                </div>
              )}

              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--color-muted)',
                  lineHeight: 1.6,
                  marginTop: 9,
                }}
              >
                {expiryChoice === 'none'
                  ? t('circles.expiryNoteNone')
                  : t('circles.expiryNoteSet')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── mảnh dùng lại ─────────────────────── */

function VisIcon({
  path,
  size,
  style,
}: {
  path: string;
  size: number;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flex: 'none', ...style }}
    >
      <path d={path} />
    </svg>
  );
}

function PersonAvatar({ name, url }: { name?: string | null; url?: string | null }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (url) {
    return (
      <img
        src={url}
        alt=""
        style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'var(--color-primary)',
        color: 'var(--color-primary-foreground)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 12.5,
        flex: 'none',
      }}
    >
      {initial}
    </span>
  );
}

const fieldLabel: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--color-muted)',
  marginBottom: 6,
  display: 'block',
};

const sectionStyle: React.CSSProperties = {
  margin: '6px 4px 2px',
  paddingTop: 10,
  borderTop: '1px solid var(--color-border)',
};

const sectionHeading: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
  marginBottom: 6,
};

const errorBoxStyle: React.CSSProperties = {
  margin: '8px 2px 2px',
  padding: '11px 13px',
  borderRadius: 12,
  background: 'var(--color-surface-muted)',
  border: '1px solid var(--color-danger)',
  color: 'var(--color-danger)',
  fontSize: 12.5,
  fontWeight: 600,
  lineHeight: 1.55,
};

const inlineFieldLabel: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
};

const inlineInput: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 11,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-muted)',
  color: 'var(--color-foreground)',
  fontSize: 13.5,
  fontFamily: 'inherit',
  fontWeight: 600,
  letterSpacing: 0,
  textTransform: 'none',
  outline: 'none',
};

function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 11,
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'left',
    padding: '11px 12px',
    borderRadius: 14,
    border: `1px solid ${active ? 'var(--color-primary-strong)' : 'transparent'}`,
    background: active ? 'var(--color-primary-soft)' : 'transparent',
    color: 'var(--color-foreground)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

function tickStyle(active: boolean): React.CSSProperties {
  return active
    ? { color: 'var(--color-primary-strong)', fontWeight: 800, fontSize: 15 }
    : { visibility: 'hidden' };
}

function segStyle(active: boolean): React.CSSProperties {
  return {
    padding: '7px 13px',
    borderRadius: 999,
    border: `1px solid ${active ? 'transparent' : 'var(--color-border)'}`,
    background: active ? 'var(--color-primary)' : 'var(--color-surface)',
    color: active ? 'var(--color-primary-foreground)' : 'var(--color-muted)',
    fontWeight: 700,
    fontSize: 12.5,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
