# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  cdn.tf — CloudFront + Origin Access Control cho bucket ảnh/video          ║
# ║  Thêm 27/08/2026, đợt "deploy dùng được".                                  ║
# ║                                                                           ║
# ║  VÌ SAO BẮT BUỘC, không phải tối ưu:                                       ║
# ║  `imageUrl` được LƯU VĨNH VIỄN vào cột DB lúc createPin. Nghĩa là URL ảnh  ║
# ║  phải công khai VÀ ổn định. Hai đường còn lại đều trượt:                    ║
# ║    · presigned GET — hết hạn sau vài phút, lưu vào DB là bom hẹn giờ;      ║
# ║    · mở public-read cho bucket — bỏ đúng ràng buộc an toàn §1 đặt có chủ   ║
# ║      đích, và vẫn không có cache header nào.                              ║
# ║  Bucket vì thế GIỮ NGUYÊN block-public-access đủ 4 cờ; chỉ CloudFront đọc  ║
# ║  được, bằng OAC (bản kế nhiệm của OAI, ký SigV4).                          ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.project}-media-oac"
  description                       = "OAC cho bucket raw — chỉ CloudFront đọc được"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  comment         = "${var.project} media (${var.env})"
  is_ipv6_enabled = true

  # PriceClass_200 = Bắc Mỹ + Âu + Á (gồm Singapore/HN-SG edge). PriceClass_All
  # thêm Nam Mỹ/Úc/NZ với giá cao hơn, không đáng cho ~50 người dùng/ngày.
  price_class = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.raw.bucket_regional_domain_name
    origin_id                = "s3-raw"
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-raw"
    viewer_protocol_policy = "redirect-to-https"

    # Chỉ ĐỌC. Bucket nhận ghi qua presigned POST đi thẳng tới S3, không qua CDN
    # — cho phép PUT/POST ở đây là mở một cửa ghi thứ hai không ai canh.
    allowed_methods = ["GET", "HEAD", "OPTIONS"]
    cached_methods  = ["GET", "HEAD"]

    # Managed-CachingOptimized: nén, bỏ qua cookie/query khi tạo khoá cache.
    cache_policy_id = data.aws_cloudfront_cache_policy.optimized.id

    # Managed-CORS-S3Origin: chuyển tiếp Origin + Access-Control-Request-* để S3
    # trả đúng header CORS. Thiếu policy này thì <img> vẫn chạy nhưng `fetch`/
    # canvas đọc ảnh sẽ bị chặn — và lỗi hiện ở tận trình duyệt.
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.cors_s3.id

    compress = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Chưa có domain riêng ⇒ dùng chứng chỉ mặc định *.cloudfront.net. Khi mua
  # được domain: thêm `aliases` + ACM cert Ở us-east-1 (KHÔNG phải ap-southeast-1
  # — CloudFront chỉ nhìn cert us-east-1, và thông báo lỗi không hề nhắc region).
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "cors_s3" {
  name = "Managed-CORS-S3Origin"
}

# ─── Bucket policy: CHỈ distribution này được GetObject ───────────────────────
#
# `AWS:SourceArn` khoá theo đúng distribution. Thiếu điều kiện đó thì bất kỳ
# distribution nào của bất kỳ account nào cũng đọc được bucket — lỗ hổng
# "confused deputy" kinh điển của OAC, và không có gì trong console báo.
data "aws_iam_policy_document" "raw_cloudfront_read" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.raw.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.media.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "raw" {
  bucket = aws_s3_bucket.raw.id
  policy = data.aws_iam_policy_document.raw_cloudfront_read.json

  # `block_public_policy = true` từ chối policy bị coi là public. Policy này KHÔNG
  # public (principal là service, có điều kiện SourceArn) nên qua được — nhưng
  # thứ tự vẫn phải tường minh, nếu không Terraform có thể đặt policy TRƯỚC khi
  # block cấu hình xong và lần apply sau sẽ lệch.
  depends_on = [aws_s3_bucket_public_access_block.raw]
}
