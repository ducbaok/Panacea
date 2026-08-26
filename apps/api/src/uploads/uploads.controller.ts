// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  UploadsController                                                       ║
// ║  REST endpoint tạo Presigned URL (chỉ auth mới dùng REST theo PLAN.md). ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. POST /uploads/presigned-url — yêu cầu JWT auth.                     ║
// ║  2. Body: PresignedUrlDto { contentType, folder? }                      ║
// ║  3. Lấy userId từ @CurrentUserRest() (kiểu AuthUser).                   ║
// ║  4. Gọi UploadsService.generatePresignedUrl() và trả kết quả.          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { AuthGuard } from '@nestjs/passport';
import {
  UploadsService,
  CONTENT_TYPE_EXT,
  MIN_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  maxUploadBytesFor,
  normalizeContentType,
} from './uploads.service';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { CurrentUserRest } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';

/**
 * Thư mục đích của upload local — phải TRÙNG với `app.useStaticAssets()`
 * trong `main.ts`, nếu không file upload lên sẽ không serve ra được.
 * Dùng đường dẫn tuyệt đối vì `diskStorage` giải nghĩa đường dẫn tương đối
 * theo cwd của process, mà cwd thay đổi tùy cách chạy (nest start / node dist
 * / docker) — đã từng là nguồn của lỗi "file upload xong rồi biến mất".
 */
const LOCAL_UPLOAD_DIR = join(process.cwd(), 'uploads');

/**
 * UploadsController — REST endpoint quản lý việc upload hình ảnh.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Gom nhóm trong Swagger bằng @ApiTags('Uploads') và yêu cầu xác thực bằng @ApiBearerAuth().
 * 2. POST /uploads/presigned-url: Dùng để sinh link presigned upload lên S3.
 * 3. POST /uploads/local: Dùng FileInterceptor để upload file trực tiếp lưu ở thư mục local.
 *    - Sử dụng @ApiConsumes('multipart/form-data') và @ApiBody() cấu hình schema cho file binary.
 * 4. Tất cả endpoints được bảo mật bằng JWT AuthGuard.
 */
@ApiTags('Uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploadsService: UploadsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * POST /uploads/presigned-url
   * Tạo Presigned POST URL để client upload ảnh trực tiếp lên S3.
   *
   * Response: { url, fields, key }
   *  - url: S3 endpoint
   *  - fields: form fields cần kèm theo POST request
   *  - key: S3 object key, client gửi lại khi gọi createPin
   */
  @Post('presigned-url')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Tạo S3 Presigned POST URL để upload ảnh trực tiếp lên AWS S3' })
  @ApiResponse({ status: 200, description: 'Trả về S3 endpoint và các fields cần thiết để upload.' })
  @ApiResponse({ status: 400, description: 'Định dạng file không được hỗ trợ.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  async getPresignedUrl(
    @Body() dto: PresignedUrlDto,
    @CurrentUserRest() user: AuthUser,
  ) {
    return this.uploadsService.generatePresignedUrl(
      user.userId,
      dto.contentType,
      dto.folder,
    );
  }

  /**
   * POST /uploads/local
   * Endpoint fallback cho local dev không dùng S3.
   *
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  P0 #7 — TRƯỚC KHI SỬA, ENDPOINT NÀY NHẬN BẤT KỲ FILE NÀO             ║
   * ║                                                                        ║
   * ║  Không `fileFilter`, không `limits`, tên file lấy phần mở rộng thẳng   ║
   * ║  từ `file.originalname` — trong khi thư mục `uploads/` được            ║
   * ║  `app.useStaticAssets()` serve ra công khai. Ba hệ quả:                ║
   * ║                                                                        ║
   * ║   1. Upload `.html`/`.svg` → truy cập được qua /uploads/x.html ⇒       ║
   * ║      stored XSS chạy trên chính origin của API.                        ║
   * ║   2. Không giới hạn dung lượng ⇒ một request lấp đầy đĩa.             ║
   * ║   3. `originalname` do client đặt: `"a.jpg\0.php"`, `"../x"`… —        ║
   * ║      không bao giờ nên tin để dựng tên file trên đĩa.                  ║
   * ║                                                                        ║
   * ║  Cách sửa: 3 lớp, mỗi lớp chặn một thứ khác nhau.                     ║
   * ║   • `limits`     → chặn theo KÍCH THƯỚC, multer cắt ngay khi đang ghi. ║
   * ║   • `fileFilter` → chặn theo MIME, dùng chung whitelist với nhánh S3.  ║
   * ║   • `filename`   → phần mở rộng suy ra TỪ MIME đã whitelist, tuyệt     ║
   * ║                     đối không đụng tới `originalname`.                 ║
   * ║                                                                        ║
   * ║  LƯU Ý — `mimetype` cũng do client khai (header của phần multipart),  ║
   * ║  nên whitelist này chống nhầm lẫn chứ không chống được kẻ cố tình gửi  ║
   * ║  payload lạ dán nhãn `image/png`. Nhưng vì phần mở rộng trên đĩa được  ║
   * ║  ép theo whitelist, thứ tệ nhất họ đạt được là một file `.png` hỏng —  ║
   * ║  không thực thi được. Muốn chắc hơn nữa thì đọc magic bytes (v2).     ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
  @Post('local')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        // XH-VIDEO — multer chỉ nhận MỘT con số, nên phải để trần CAO NHẤT
        // (30MB của video) ở đây rồi siết lại theo loại trong handler. Đổi lại,
        // một tấm ảnh 25MB được ghi xuống đĩa trước khi bị từ chối — chấp nhận
        // được vì handler xoá ngay, và đây là endpoint chỉ chạy ở local dev
        // (production đã chặn cứng bên dưới).
        fileSize: MAX_VIDEO_UPLOAD_BYTES,
        files: 1,                   // chỉ 1 file/request
        fields: 0,                  // không nhận field phụ nào khác
      },
      fileFilter: (req, file, cb) => {
        // `normalizeContentType` cắt tham số codec: MediaRecorder gửi
        // `video/webm;codecs="vp9,opus"`, tra thẳng vào whitelist là trượt.
        if (!CONTENT_TYPE_EXT[normalizeContentType(file.mimetype)]) {
          const allowed = Object.keys(CONTENT_TYPE_EXT).join(', ');
          return cb(
            new BadRequestException(`Unsupported file type "${file.mimetype}". Allowed: ${allowed}`),
            false,
          );
        }
        cb(null, true);
      },
      storage: diskStorage({
        destination: (req, file, cb) => {
          if (!fs.existsSync(LOCAL_UPLOAD_DIR)) {
            fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
          }
          cb(null, LOCAL_UPLOAD_DIR);
        },
        filename: (req, file, cb) => {
          // Phần mở rộng suy ra từ MIME đã qua fileFilter — KHÔNG dùng
          // extname(file.originalname).
          cb(null, `${randomUUID()}.${CONTENT_TYPE_EXT[normalizeContentType(file.mimetype)]}`);
        },
      }),
    }),
  )
  @ApiOperation({ summary: 'Upload file lên server local (fallback cho local development)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Upload thành công, trả về local URL và key.' })
  @ApiResponse({ status: 400, description: 'Không có file, file rỗng, hoặc định dạng không được hỗ trợ.' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực.' })
  @ApiResponse({ status: 413, description: 'File vượt trần: ảnh 10MB, video 30MB.' })
  async uploadLocal(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUserRest() user: AuthUser,
  ) {
    // ── HT-3 lỗ hổng #6 (nhánh GHI) ─────────────────────────────────────────
    //
    // Fargate có filesystem **ephemeral**: file ghi ở đây biến mất khi task
    // restart và KHÔNG chia sẻ giữa các task. Ảnh sẽ 404 một cách ngẫu nhiên
    // tuỳ request rơi vào task nào — hình dạng sự cố cực khó truy vì "lúc được
    // lúc không". Trên production chỉ còn đường presigned/S3.
    //
    // ⚠️ Chặn ở ĐÂY chứ không chỉ ở `main.ts`. `main.ts` tắt `useStaticAssets`
    // (nhánh ĐỌC); nếu chỉ làm vế đó thì endpoint này vẫn ghi file vào một
    // thư mục không ai đọc được — mất đĩa, và trả về URL 404. Hai lớp cho hai
    // chiều đọc/ghi; thiếu lớp nào cũng còn nửa lỗ hổng.
    //
    // Ném TRƯỚC mọi thứ khác, nhưng lưu ý: `FileInterceptor` đã chạy xong và
    // có thể đã ghi file xuống đĩa rồi ⇒ phải dọn, y như nhánh "file quá nhỏ"
    // bên dưới. Không dọn thì mỗi request bị từ chối lại để lại một file rác.
    if (process.env.NODE_ENV === 'production') {
      if (file?.path) await fs.promises.unlink(file.path).catch(() => undefined);
      throw new ForbiddenException(
        'Local upload is disabled in production. Use POST /uploads/presigned-url.',
      );
    }

    if (!file) throw new BadRequestException('No file uploaded');

    // Chặn dưới 1KB cho khớp `content-length-range` của nhánh S3.
    // Multer không có `minFileSize`, nên phải kiểm tra SAU khi đã ghi xuống đĩa
    // → bắt buộc phải dọn file rác, nếu không mỗi lần từ chối lại để lại 1 file.
    if (file.size < MIN_UPLOAD_BYTES) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      throw new BadRequestException(`File too small (min ${MIN_UPLOAD_BYTES} bytes)`);
    }

    // XH-VIDEO — trần THEO LOẠI, siết lại sau khi multer đã cho qua ở mức 30MB.
    // Cùng hình dạng với nhánh "file quá nhỏ" ngay trên: multer đã ghi file
    // xuống đĩa rồi, nên phải dọn — không dọn thì mỗi ảnh 25MB bị từ chối lại
    // để lại 25MB rác. Trả 413 (không phải 400) để khớp đúng nhánh `too-large`
    // mà `apps/web/lib/upload.ts` nhận diện bằng STATUS.
    const maxBytes = maxUploadBytesFor(file.mimetype);
    if (file.size > maxBytes) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      throw new PayloadTooLargeException(
        `File too large (max ${maxBytes} bytes for "${normalizeContentType(file.mimetype)}")`,
      );
    }

    // Trước đây hardcode 'http://localhost:4000' (vấn đề S6 trong báo cáo) —
    // URL đó sai ngay khi chạy trong Docker hoặc deploy. Nay lấy từ APP_BASE_URL.
    const baseUrl = this.configService.get<string>('app.baseUrl');
    return { url: `${baseUrl}/uploads/${file.filename}`, key: file.filename };
  }
}
