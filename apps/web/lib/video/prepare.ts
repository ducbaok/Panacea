import { precheckVideoFile, uploadBlob, UploadError } from '@/lib/upload';
import { prepareAndUploadImage, type PreparedImage } from '@/lib/image/prepare';

/**
 * XH-VIDEO (26/08/2026) — MỘT tiến trình cho cả poster lẫn video.
 *
 * Cùng luật với `lib/image/prepare.ts` (spec capture mục 4): người dùng chỉ
 * được thấy MỘT tiến trình. Pin video là pin ảnh CÓ THÊM một file — poster đi
 * qua đúng `prepareAndUploadImage`, không có nhánh resize thứ hai, nên ba biến
 * thể `thumbnail/medium/large` của pin video giống hệt pin ảnh và mọi bề mặt
 * đang vẽ ảnh không phải biết gì về video.
 *
 * Ba quyết định đáng ghi:
 *
 * 1. **Poster và video tải lên SONG SONG.** Chúng độc lập, và tổng thời gian
 *    chờ là thứ người dùng cảm nhận trực tiếp ở màn này (video tới 30MB).
 *
 * 2. **Video hỏng ⇒ NÉM, không âm thầm đăng thành pin ảnh.** Đây là khác biệt
 *    cố ý so với nhánh biến thể của ảnh (ở đó nuốt lỗi là đúng, vì ảnh gốc vẫn
 *    đăng được). Người dùng bấm "Dùng video này" mà nhận về một pin ảnh tĩnh
 *    là hình dạng lỗi tệ nhất: không ai báo gì, và họ chỉ phát hiện khi mở pin
 *    ra xem.
 *
 * 3. **Tiền-kiểm TRƯỚC khi tải poster.** Video quá 30MB thì hỏng cả pin; phát
 *    hiện sớm để không tốn một vòng tải poster rồi mới báo lỗi.
 */

export type PreparedVideo = PreparedImage & {
  /** URL tuyệt đối của file video — `createPin.videoUrl`. */
  videoUrl: string;
  /** Thời lượng thật của đoạn quay (ms) — `createPin.videoDurationMs`. */
  videoDurationMs: number;
};

export async function prepareAndUploadVideo(
  video: File,
  poster: File,
  durationMs: number,
  accessToken: string | null | undefined,
): Promise<PreparedVideo> {
  const bad = precheckVideoFile(video);
  if (bad) throw new UploadError(bad);

  const [prepared, uploaded] = await Promise.all([
    // Số đo poster = số đo khung hình video ⇒ masonry chừa đúng chỗ.
    prepareAndUploadImage(poster, accessToken),
    // `video.name` mang đuôi đúng theo `blob.type` (đặt ở `capture-view.tsx`);
    // multer đọc MIME chứ không đọc tên, nhưng tên vẫn đi vào log của server.
    uploadBlob(video, video.name || 'capture.webm', accessToken),
  ]);

  return {
    ...prepared,
    videoUrl: uploaded.url,
    // Làm tròn: `MediaRecorder` cho ra số lẻ, mà `videoDurationMs` là Int ở SDL
    // — gửi 15003.7 lên là 400 "Int cannot represent non-integer value".
    videoDurationMs: Math.max(1, Math.round(durationMs)),
  };
}
