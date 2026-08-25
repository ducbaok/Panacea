import { MIN_UPLOAD_BYTES, UploadError, measureImage, uploadBlob, uploadImage } from '@/lib/upload';
import { canResize, resizeToVariants, type VariantName } from '@/lib/image/resize';

/**
 * XH-9b — MỘT tiến trình duy nhất cho cả thu nhỏ lẫn tải lên.
 *
 * Spec (`spec-man-xahoi-capture.md` mục 4) nói rõ: người dùng chỉ được thấy MỘT
 * tiến trình, không tách bước "đang thu nhỏ" ra cho họ nhìn. Vì thế cả hai
 * đường vào — chọn file từ đĩa và chụp bằng camera — đều gọi đúng hàm này.
 *
 * Kết quả trả về khớp thẳng với `CreatePinInput`:
 *   imageUrl                          — ảnh GỐC (đường lui của mọi biến thể)
 *   thumbnailUrl / mediumUrl / largeUrl — nullable, thiếu cái nào cũng không sao
 *   width / height                    — số đo ảnh GỐC (bẫy 3 của PLAN_XAHOI §8)
 *
 * Ba quyết định đáng ghi:
 *
 * 1. **Thu nhỏ hỏng KHÔNG được làm hỏng việc đăng pin.** Khâu biến thể là để
 *    tiết kiệm băng thông; ảnh gốc vẫn đăng được nếu canvas/WebP trục trặc.
 *    Nên mọi lỗi ở nhánh biến thể đều bị nuốt, còn lỗi ở nhánh ảnh gốc thì ném.
 *
 * 2. **Biến thể nhỏ hơn 1KB bị bỏ.** Server có sàn `MIN_UPLOAD_BYTES = 1024`
 *    và trả 400 "File too small" — một tấm ảnh nền phẳng thu xuống 480px thừa
 *    sức chui xuống dưới sàn đó. Bỏ đi và để FE rơi về `imageUrl` là đúng hợp
 *    đồng (ba URL vốn nullable), còn để nó bay lên là tự chuốc một lỗi 400.
 *
 * 3. **Ba URL tuyệt đối + whitelist domain** (bẫy 2 của PLAN_XAHOI §8) đến
 *    MIỄN PHÍ ở đây: biến thể đi qua đúng cửa `POST /uploads/local` với ảnh
 *    gốc, nên nhận cùng một origin đã nằm trong whitelist. Đừng thay bằng
 *    `URL.createObjectURL` hay data: URI — cả hai đều trượt whitelist.
 */

export type PreparedImage = {
  imageUrl: string;
  thumbnailUrl?: string;
  mediumUrl?: string;
  largeUrl?: string;
  /** Số đo ảnh GỐC (đã áp EXIF) — masonry chừa chỗ theo tỉ lệ này. */
  width: number;
  height: number;
  /** Số biến thể tải lên được — dùng cho log/bằng chứng, không hiện ra mắt. */
  variantCount: number;
};

const VARIANT_FIELD: Record<VariantName, 'thumbnailUrl' | 'mediumUrl' | 'largeUrl'> = {
  thumbnail: 'thumbnailUrl',
  medium: 'mediumUrl',
  large: 'largeUrl',
};

function extensionFor(mimeType: string): string {
  return mimeType === 'image/webp' ? 'webp' : 'jpg';
}

export async function prepareAndUploadImage(
  file: File,
  accessToken: string | null | undefined,
): Promise<PreparedImage> {
  // Thu nhỏ TRƯỚC khi upload ảnh gốc: `resizeToVariants` cũng là chỗ đọc EXIF
  // và trả số đo GỐC, nên chạy được nó thì không cần `measureImage` nữa.
  let resized: Awaited<ReturnType<typeof resizeToVariants>> | null = null;
  if (canResize(file)) {
    try {
      resized = await resizeToVariants(file);
    } catch {
      resized = null; // xem quyết định 1 ở docblock
    }
  }

  const originalUpload = uploadImage(file, accessToken);

  const variantUploads = (resized?.variants ?? [])
    .filter((v) => v.blob.size >= MIN_UPLOAD_BYTES) // quyết định 2
    .map(async (v) => {
      const name = `${v.name}-${v.width}x${v.height}.${extensionFor(resized!.mimeType)}`;
      const res = await uploadBlob(v.blob, name, accessToken);
      return { field: VARIANT_FIELD[v.name], url: res.url };
    });

  const [original, variants] = await Promise.all([
    originalUpload, // lỗi ở đây ĐƯỢC ném ra ngoài — không có ảnh gốc thì không có pin
    Promise.allSettled(variantUploads),
  ]);

  const out: PreparedImage = {
    imageUrl: original.url,
    width: 0,
    height: 0,
    variantCount: 0,
  };

  for (const settled of variants) {
    if (settled.status === 'fulfilled') {
      out[settled.value.field] = settled.value.url;
      out.variantCount += 1;
    }
  }

  if (resized) {
    out.width = resized.original.width;
    out.height = resized.original.height;
  } else {
    // GIF (không đi qua canvas) hoặc canvas trục trặc: vẫn phải có tỉ lệ, và
    // `measureImage` đọc bằng `createImageBitmap`/`<img>` như trước F1.
    const dims = await measureImage(file);
    out.width = dims.width;
    out.height = dims.height;
  }

  if (out.width < 1 || out.height < 1) {
    throw new UploadError('unknown', { serverMessage: 'Không đọc được kích thước ảnh' });
  }
  return out;
}
