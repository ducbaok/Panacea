'use client';

import { useCallback, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useMutation } from '@apollo/client/react';
import { UpdateProfileDocument, MeDocument } from '@/lib/gql/graphql';
import { precheckFile, uploadImage, UploadError, type UploadErrorKind } from '@/lib/upload';
import { uploadErrorText } from '@/lib/errors/upload-error-vi';
import { useToast } from '@/components/ui/toast';

/**
 * FE-10 — luồng đổi ảnh đại diện, dùng CHUNG cho hai điểm bấm đã vẽ ở
 * `Panacea-v2.1.html`: nút camera trên avatar C1a (view=profile) và hàng "Đổi
 * ảnh đại diện" ở C2 (view=settings). Một hook, hai chỗ gọi — hai bản chép sẽ
 * lệch nhau ở đúng cái khó thấy nhất (payload gửi lên).
 *
 * Luồng: chọn file → `POST /uploads/local` (khuôn FE-7, `lib/upload.ts`) → nhận
 * URL tuyệt đối → `updateProfile({ avatarUrl })`.
 *
 * 🔴 CHỈ gửi `avatarUrl` (§4.9). `UpdateProfileInput` mọi field optional và
 * backend spread thẳng input vào `prisma.user.update`; gửi kèm `username` sẽ kích
 * validator regex + luật "đổi 1 lần / 30 ngày" + kiểm trùng — toàn bộ chẳng liên
 * quan gì tới ảnh, và sẽ chặn việc đổi ảnh vì một lý do người dùng không hiểu.
 *
 * ⚠️ Hint "Ảnh vuông, tối thiểu 200×200." của bản vẽ là UI-only: backend KHÔNG
 * kiểm tỉ lệ hay kích thước tối thiểu (chỉ MIME + 1KB..10MB). Đừng đọc hint đó
 * thành ràng buộc rồi tự chặn — nó là lời khuyên cho ảnh đẹp.
 *
 * KHÔNG đo kích thước ảnh (`measureImage`): avatar hiển thị crop tròn cố định,
 * không có masonry nào cần tỉ lệ. B4 phải đo vì `createPin` bắt buộc w/h.
 */
export type AvatarUploadPhase = 'idle' | 'working' | 'error';

export interface UseAvatarUploadResult {
  /** Mở hộp chọn file. */
  pick: () => void;
  /** Gắn vào JSX một lần ở mỗi chỗ dùng — input file ẩn. */
  inputProps: {
    ref: React.RefObject<HTMLInputElement | null>;
    type: 'file';
    accept: string;
    hidden: true;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  };
  phase: AvatarUploadPhase;
  /** Chuỗi tiếng Việt đã duyệt của lỗi gần nhất; null khi không có lỗi. */
  errorText: string | null;
}

/**
 * Field hồ sơ sẽ được ghi sau khi upload xong.
 *
 * REVIEW-1 (#6) — thêm `coverUrl` (ảnh bìa). Cùng một luồng y hệt avatar: chọn
 * file → `POST /uploads/local` → `updateProfile({ <field>: url })`; khác đúng
 * tên field và câu toast. Tham số hoá thay vì chép hook thứ hai, vì bản chép sẽ
 * lệch ở đúng chỗ khó thấy nhất (payload) — chính lý do hook này được gom lại.
 */
export type ProfileImageField = 'avatarUrl' | 'coverUrl';

const FIELD_LABEL: Record<ProfileImageField, string> = {
  avatarUrl: 'ảnh đại diện',
  coverUrl: 'ảnh bìa',
};

export function useAvatarUpload(
  field: ProfileImageField = 'avatarUrl',
): UseAvatarUploadResult {
  const { data: session } = useSession();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<AvatarUploadPhase>('idle');
  const [errorKind, setErrorKind] = useState<UploadErrorKind | null>(null);
  const [updateProfile] = useMutation(UpdateProfileDocument);

  const pick = useCallback(() => {
    if (phase === 'working') return;
    inputRef.current?.click();
  }, [phase]);

  const onChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset ngay: chọn LẠI cùng một file phải kích hoạt onChange lần nữa.
      e.target.value = '';
      if (!file) return;

      const pre = precheckFile(file);
      if (pre) {
        setErrorKind(pre);
        setPhase('error');
        toast({ message: uploadErrorText(pre) });
        return;
      }

      setErrorKind(null);
      setPhase('working');
      try {
        const { url } = await uploadImage(file, session?.accessToken);
        // CHỈ đúng MỘT field. Mutation trả về User đầy đủ ⇒ Apollo cache tự cập
        // nhật theo id, nên topbar/hồ sơ đổi ảnh không cần refetch tay.
        // `refetchQueries` cho Me là lưới thứ hai cho chỗ đọc `me` mà cache
        // chưa chuẩn hoá tới.
        await updateProfile({
          variables: { input: { [field]: url } },
          refetchQueries: [{ query: MeDocument }],
        });
        setPhase('idle');
        toast({ message: `Đã cập nhật ${FIELD_LABEL[field]}.` });
      } catch (err) {
        const kind: UploadErrorKind = err instanceof UploadError ? err.kind : 'unknown';
        setErrorKind(kind);
        setPhase('error');
        toast({ message: uploadErrorText(kind) });
      }
    },
    [field, session?.accessToken, toast, updateProfile],
  );

  return {
    pick,
    inputProps: {
      ref: inputRef,
      type: 'file',
      accept: 'image/jpeg,image/png,image/gif,image/webp',
      hidden: true,
      onChange: (e) => void onChange(e),
    },
    phase,
    errorText: phase === 'error' ? uploadErrorText(errorKind) : null,
  };
}
