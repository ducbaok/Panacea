/**
 * XH-9b — Thu nhỏ ảnh NGAY TRÊN MÁY người dùng thành 3 biến thể trước khi upload.
 *
 * Vì sao ở client chứ không Lambda+Sharp: `docs/xahoi-phi-chuc-nang.md` §2 —
 * một lần cuộn lưới ~40 ảnh gốc ≈ 120MB vs ~1.6MB khi có thumbnail. Đây là
 * quyết định về TIỀN (egress), không phải về đẹp.
 *
 * ─────────────────── BA BẪY (PLAN_XAHOI.md §8) ───────────────────
 *
 * 1. 🔴 EXIF ORIENTATION. Canvas vẽ PIXEL THÔ; thẻ xoay của máy ảnh không đi
 *    theo. Ảnh chụp dọc bằng điện thoại thường được lưu là buffer NGANG + thẻ
 *    `Orientation = 6` ("xoay phải 90°"). Vẽ thẳng lên canvas ⇒ ảnh dọc thành
 *    ảnh nằm ngang, và vì bản gốc vẫn hiển thị đúng ở mọi nơi khác nên lỗi chỉ
 *    lộ ra SAU khi đăng.
 *
 *    Cách xử lý ở file này — ĐO chứ không giả định:
 *      • Tự đọc thẻ `Orientation` từ khối APP1/EXIF của file JPEG.
 *      • Tự đọc số đo PIXEL THÔ từ khối SOF của chính file JPEG.
 *      • Giải mã, rồi SO SÁNH số đo trình duyệt trả về với số đo thô: khớp
 *        nghĩa là trình duyệt CHƯA xoay (ta phải xoay), đảo nghĩa là trình
 *        duyệt ĐÃ xoay (ta không được xoay lần nữa).
 *
 *    🔴 Bản đầu của file này truyền `createImageBitmap(file, {imageOrientation:
 *    'none'})` và TIN rằng như thế luôn nhận được pixel thô. Đo thật trên
 *    Chrome 24/08/2026 cho thấy điều đó SAI: cả 'none', 'from-image' lẫn không
 *    truyền option đều trả về ảnh ĐÃ XOAY (2400×1800 thô ⇒ 1800×2400). Giả
 *    định đó làm số đo gửi lên API bị đảo (ảnh dọc khai là ngang) và làm phép
 *    xoay của ta chạy thành lần thứ hai. Đây đúng là lý do bẫy này được ghi ra
 *    thành văn: cách nào "nghe có vẻ tất định" cũng phải đối chiếu bằng số đo.
 *
 *    Khi không kết luận được (ảnh vuông, thẻ chỉ lật không xoay, không đọc
 *    được SOF), mặc định là TIN TRÌNH DUYỆT ĐÃ XOAY — mọi trình duyệt hiện đại
 *    đều áp EXIF khi giải mã, và đoán sai theo chiều này chỉ đưa ta về đúng
 *    hành vi vốn có trước F1 thay vì xoay ảnh thành sai.
 *
 *    Đường lui `<img>` (khi không có `createImageBitmap`) cũng tự áp EXIF (CSS
 *    `image-orientation: from-image` là mặc định), nên nhánh đó luôn khai đã xoay.
 *
 * 2. Ba URL biến thể vẫn phải là **URL tuyệt đối** và vẫn qua **whitelist
 *    domain** giống `imageUrl`. File này không tự đặt URL — nó trả `Blob`, còn
 *    URL do `POST /uploads/local` sinh ra (cùng một cửa với ảnh gốc, nên cùng
 *    một domain đã nằm trong whitelist). Xem `lib/upload.ts`.
 *
 * 3. `imageWidth`/`imageHeight` gửi lên API phải là số đo **ảnh GỐC**, không
 *    phải của bản thu nhỏ — lưới masonry dùng tỉ lệ đó để chừa chỗ TRƯỚC khi
 *    ảnh về. `ResizeResult.original` chính là cặp số đó, và nó là số đo SAU khi
 *    đã áp EXIF (tức là cái người dùng nhìn thấy: dọc vẫn ra dọc).
 */

/** Cạnh dài nhất của từng biến thể, tính bằng pixel. */
export const VARIANT_MAX_EDGE = {
  /** Lưới masonry rộng 236px/cột (FE-3) ⇒ 480 phủ được màn hình 2× DPR. */
  thumbnail: 480,
  /** Cột chi tiết pin và bản xem trước. */
  medium: 900,
  /** Ảnh mở to hết cỡ; trên mức này gần như không ai phân biệt được. */
  large: 1600,
} as const;

export type VariantName = keyof typeof VARIANT_MAX_EDGE;

export const VARIANT_ORDER: readonly VariantName[] = ['thumbnail', 'medium', 'large'];

export type ResizedVariant = {
  name: VariantName;
  blob: Blob;
  width: number;
  height: number;
};

export type ResizeResult = {
  /**
   * Số đo ảnh GỐC sau khi đã áp EXIF — đây là cặp số gửi lên
   * `createPin.imageWidth/imageHeight` (bẫy 3).
   */
  original: { width: number; height: number };
  /**
   * Các biến thể đã sinh, KHÔNG bao giờ phóng to: biến thể nào có cạnh đích
   * ≥ cạnh dài của ảnh gốc thì bị bỏ (dùng lại ảnh gốc là đủ). Ảnh 300px chỉ
   * ra 0 biến thể — đúng, vì thu nhỏ nữa là làm xấu mà không tiết kiệm gì.
   */
  variants: ResizedVariant[];
  /** MIME của các biến thể ('image/webp' hoặc 'image/jpeg' khi không có webp). */
  mimeType: string;
};

/**
 * GIF không đi qua canvas: canvas chỉ giữ được MỘT khung ⇒ ảnh động thành ảnh
 * tĩnh. Người dùng chọn ảnh động mà nhận về ảnh chết là hỏng dữ liệu, không
 * phải tối ưu. Chỗ gọi thấy `variants: []` thì cứ đăng ảnh gốc.
 */
export function canResize(file: File): boolean {
  return file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp';
}

/* ───────────────────────── EXIF ───────────────────────── */

/**
 * Đọc thẻ `Orientation` (0x0112) trong khối APP1 của JPEG. Trả 1 khi không có
 * EXIF, không phải JPEG, hoặc file hỏng — 1 nghĩa là "không phải xoay gì".
 *
 * Cố ý đọc tay thay vì kéo một thư viện EXIF: ta cần ĐÚNG một thẻ, và thẻ đó
 * nằm ngay đầu file nên chỉ phải đọc 128KB đầu.
 */
export async function readExifOrientation(file: File): Promise<number> {
  if (file.type !== 'image/jpeg') return 1;
  let view: DataView;
  try {
    // EXIF luôn nằm trong vài khối đầu; đọc cả file chỉ để tìm 2 byte là phí.
    view = new DataView(await file.slice(0, 128 * 1024).arrayBuffer());
  } catch {
    return 1;
  }
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1; // SOI

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset, false);
    if ((marker & 0xff00) !== 0xff00) return 1; // lạc khỏi chuỗi marker
    const size = view.getUint16(offset + 2, false);
    if (size < 2) return 1;

    if (marker === 0xffe1) {
      const app1 = offset + 4;
      // "Exif\0\0"
      if (app1 + 6 > view.byteLength || view.getUint32(app1, false) !== 0x45786966) return 1;
      const tiff = app1 + 6;
      if (tiff + 8 > view.byteLength) return 1;

      const little = view.getUint16(tiff, false) === 0x4949;
      if (view.getUint16(tiff + 2, little) !== 0x002a) return 1;
      const ifd0 = tiff + view.getUint32(tiff + 4, little);
      if (ifd0 + 2 > view.byteLength) return 1;

      const count = view.getUint16(ifd0, little);
      for (let i = 0; i < count; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }

    if (marker === 0xffda) return 1; // tới dữ liệu ảnh — hết chỗ có EXIF
    offset += 2 + size;
  }
  return 1;
}

/** Thẻ 5–8 xoay 90° ⇒ chiều ngang/dọc của ảnh HIỂN THỊ đảo so với pixel thô. */
export function orientationSwapsAxes(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Số đo PIXEL THÔ đọc từ khối SOF của JPEG — mốc đối chứng để biết trình duyệt
 * đã xoay hay chưa. Trả null khi không phải JPEG hoặc không tìm thấy SOF.
 *
 * Bỏ qua SOF4 (0xC4 — bảng Huffman), SOF8 (0xC8) và SOFC (0xCC — arithmetic
 * conditioning): ba mã đó nằm trong dải 0xC0–0xCF nhưng KHÔNG phải khung ảnh.
 */
export async function readJpegPixelSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (file.type !== 'image/jpeg') return null;
  let view: DataView;
  try {
    view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    return null;
  }
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset, false);
    if ((marker & 0xff00) !== 0xff00) return null;
    const size = view.getUint16(offset + 2, false);
    if (size < 2) return null;
    const code = marker & 0xff;
    const isFrame =
      code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc;
    if (isFrame) {
      if (offset + 9 > view.byteLength) return null;
      // SOF: [len:2][precision:1][height:2][width:2]…
      return {
        height: view.getUint16(offset + 5, false),
        width: view.getUint16(offset + 7, false),
      };
    }
    if (code === 0xda) return null; // tới dữ liệu quét — không còn SOF nào nữa
    offset += 2 + size;
  }
  return null;
}

/* ─────────────────────── Giải mã ─────────────────────── */

/**
 * Trình duyệt đã tự áp thẻ xoay chưa? ĐO bằng cách so số đo nó trả về với số
 * đo thô trong file, thay vì tin vào một option (xem bẫy 1).
 *
 * Chỉ kết luận chắc chắn được với thẻ 5–8 (xoay 90°, làm ĐỔI chiều). Với ảnh
 * vuông, với thẻ chỉ lật (2/3/4), hoặc khi không đọc được SOF thì trả `true`
 * — mặc định an toàn: tin trình duyệt đã xoay.
 */
async function decoderAppliedOrientation(
  file: File,
  orientation: number,
  bitmap: ImageBitmap,
): Promise<boolean> {
  if (orientation === 1 || !orientationSwapsAxes(orientation)) return true;
  const raw = await readJpegPixelSize(file);
  if (!raw || raw.width === raw.height) return true;
  if (bitmap.width === raw.width && bitmap.height === raw.height) return false; // pixel thô
  return true; // đã đảo chiều ⇒ trình duyệt xoay rồi
}

type Decoded = {
  source: CanvasImageSource;
  /** Số đo PIXEL THÔ của nguồn (chưa áp EXIF nếu `orientationApplied` = false). */
  rawWidth: number;
  rawHeight: number;
  /** true ⇒ nguồn ĐÃ được trình duyệt xoay sẵn, ta không được xoay lần nữa. */
  orientationApplied: boolean;
  release: () => void;
};

async function decodeImage(file: File, orientation: number): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      rawWidth: bitmap.width,
      rawHeight: bitmap.height,
      orientationApplied: await decoderAppliedOrientation(file, orientation, bitmap),
      release: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
    return {
      source: img,
      rawWidth: img.naturalWidth,
      rawHeight: img.naturalHeight,
      // <img> tự áp EXIF (image-orientation: from-image là mặc định của CSS).
      orientationApplied: true,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Đặt canvas + ma trận biến đổi cho một thẻ EXIF. `w`/`h` là số đo ĐÃ áp thẻ
 * (tức số đo hiển thị); hàm tự đảo lại khi vẽ pixel thô lên.
 */
function applyOrientation(
  ctx: CanvasRenderingContext2D,
  orientation: number,
  w: number,
  h: number,
): void {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, w, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, w, h);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, h);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, w, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, w, h);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, h);
      break;
    default:
      break; // 1 — không làm gì
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      mimeType,
      quality,
    );
  });
}

/** Trình duyệt nào cũng có JPEG; WebP nhỏ hơn ~25–35% nên ưu tiên khi có. */
function pickOutputMime(): string {
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    if (probe.toDataURL('image/webp').startsWith('data:image/webp')) return 'image/webp';
  } catch {
    /* rơi về jpeg */
  }
  return 'image/jpeg';
}

/**
 * Thu nhỏ nhiều bậc: mỗi bước giảm tối đa một nửa. Giảm thẳng từ 4000px xuống
 * 480px trong MỘT lần `drawImage` cho ra ảnh vỡ hạt (trình duyệt lấy mẫu điểm,
 * không lấy trung bình vùng) — chia bậc là cách rẻ nhất để hết răng cưa.
 */
function downscaleStepwise(
  source: CanvasImageSource,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): HTMLCanvasElement {
  let currentW = fromWidth;
  let currentH = fromHeight;
  let current: CanvasImageSource = source;

  while (currentW / 2 > toWidth && currentH / 2 > toHeight) {
    const nextW = Math.max(toWidth, Math.round(currentW / 2));
    const nextH = Math.max(toHeight, Math.round(currentH / 2));
    const step = makeCanvas(nextW, nextH);
    const stepCtx = step.getContext('2d');
    if (!stepCtx) break;
    stepCtx.imageSmoothingEnabled = true;
    stepCtx.imageSmoothingQuality = 'high';
    stepCtx.drawImage(current, 0, 0, nextW, nextH);
    current = step;
    currentW = nextW;
    currentH = nextH;
  }

  const out = makeCanvas(toWidth, toHeight);
  const ctx = out.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, toWidth, toHeight);
  }
  return out;
}

/**
 * Sinh 3 biến thể + trả số đo ảnh gốc (đã áp EXIF).
 *
 * Ném khi không giải mã được ảnh — chỗ gọi phải bắt và vẫn đăng được ảnh gốc,
 * vì hỏng khâu tiết kiệm băng thông không đáng để hỏng cả việc đăng pin.
 */
export async function resizeToVariants(file: File): Promise<ResizeResult> {
  const orientation = await readExifOrientation(file);
  const decoded = await decodeImage(file, orientation);

  try {
    const swap = !decoded.orientationApplied && orientationSwapsAxes(orientation);
    // Số đo HIỂN THỊ của ảnh gốc — cái người dùng nhìn thấy, và là cái masonry cần.
    const originalWidth = swap ? decoded.rawHeight : decoded.rawWidth;
    const originalHeight = swap ? decoded.rawWidth : decoded.rawHeight;
    const longestEdge = Math.max(originalWidth, originalHeight);

    // Bước 1 — dựng một bản "đã xoay đúng" ở kích thước gốc, rồi mọi biến thể
    // đều thu nhỏ từ bản này. Xoay một lần thay vì xoay ba lần.
    let uprightSource: CanvasImageSource = decoded.source;
    if (!decoded.orientationApplied && orientation !== 1) {
      const upright = makeCanvas(originalWidth, originalHeight);
      const ctx = upright.getContext('2d');
      if (ctx) {
        applyOrientation(ctx, orientation, originalWidth, originalHeight);
        ctx.drawImage(decoded.source, 0, 0);
        uprightSource = upright;
      }
    }

    const mimeType = pickOutputMime();
    const quality = mimeType === 'image/webp' ? 0.82 : 0.85;
    const variants: ResizedVariant[] = [];

    for (const name of VARIANT_ORDER) {
      const maxEdge = VARIANT_MAX_EDGE[name];
      // Không bao giờ phóng to: ảnh đã nhỏ hơn đích thì biến thể này vô nghĩa.
      if (maxEdge >= longestEdge) continue;
      const scale = maxEdge / longestEdge;
      const width = Math.max(1, Math.round(originalWidth * scale));
      const height = Math.max(1, Math.round(originalHeight * scale));
      const canvas = downscaleStepwise(uprightSource, originalWidth, originalHeight, width, height);
      variants.push({ name, blob: await toBlob(canvas, mimeType, quality), width, height });
    }

    return { original: { width: originalWidth, height: originalHeight }, variants, mimeType };
  } finally {
    decoded.release();
  }
}

/**
 * Chụp ảnh từ camera cho ra Blob PNG/JPEG KHÔNG có EXIF (canvas không sinh thẻ
 * xoay), nên đường chụp đi thẳng vào cùng pipeline mà không cần đọc EXIF —
 * `readExifOrientation` trả 1 và mọi thứ còn lại giống hệt ảnh chọn từ máy.
 * Hàm này chỉ để chỗ gọi khai ý định cho rõ, không có logic riêng.
 */
export const captureNeedsNoExifFix = true;
