# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  data.tf — RDS Postgres + S3 (ElastiCache đã gỡ 27/08/2026, xem §Redis)   ║
# ║                                                                           ║
# ║  RDS `publicly_accessible = false` — nằm trong VPC, kể cả khi subnet là    ║
# ║  public (§8.F). Máy dev muốn nối DB prod thì port-forward qua              ║
# ║  `aws ssm start-session`, ĐỪNG mở 5432 ra internet.                        ║
# ║                                                                           ║
# ║  💰 RDS nay là dòng chi phí LỚN NHẤT: $18.25/tháng cho instance            ║
# ║  (db.t4g.micro, $0.025/giờ) + ~$2.5 storage. Nó cũng là thứ duy nhất ở đây ║
# ║  KHÔNG gộp vào task được — dữ liệu thật không sống trên đĩa ephemeral.     ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

# ─── Postgres ─────────────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db-subnets"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true # mã hoá at-rest — bắt buộc theo PLAN_DEPLOYMENT §1

  db_name  = "antigravity"
  username = "antigravity"
  password = var.db_password
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  # Sao lưu: 7 ngày. ⚠️ HT-8 nhắc — backup CHƯA TỪNG phục hồi thử thì chưa
  # phải backup. Nhớ chạy thử restore một lần rồi ghi lại ngày.
  backup_retention_period = 7
  backup_window           = "18:00-19:00" # UTC = 01:00-02:00 giờ VN
  maintenance_window      = "Mon:19:00-Mon:20:00"

  # Nâng minor tự động; major thì không (đổi major phải có chủ ý).
  auto_minor_version_upgrade = true

  # 🔴 skip_final_snapshot = true ⇒ destroy là MẤT SẠCH dữ liệu, không lùi được.
  #    Đang để true vì đợt này còn destroy→apply nhiều lần để kiểm IaC.
  #    ĐỔI THÀNH false trước khi có dữ liệu thật đầu tiên.
  #    (§8.I cảnh báo ngược lại: final snapshot vẫn TÍNH TIỀN sau destroy.)
  skip_final_snapshot = true
  deletion_protection = false

  # Không bật Performance Insights / Enhanced Monitoring ở nấc này — tốn thêm
  # mà chưa có traffic để nhìn.
}

# ─── Redis / Valkey — ĐÃ GỠ KHỎI HẠ TẦNG 27/08/2026 ───────────────────────────
#
# ElastiCache `cache.t4g.micro` Valkey = **$14.02/tháng** (Pricing API,
# ap-southeast-1, 27/08 — $0.0192/giờ × 730). Đó là 17% tổng chi phí cho một
# thứ chỉ giữ ba bộ đếm có TTL ngắn: khoá brute-force, hạn mức tạo pin, và
# backlog pub/sub của GraphQL Subscriptions.
#
# Nay Valkey chạy làm CONTAINER PHỤ trong chính task ứng dụng (`ecs.tf`), nghe
# trên 127.0.0.1 của network namespace — $0 thêm ngoài 256MB RAM.
#
# 🔴 CÁI GIÁ, ghi ở đây để người dựng lại không phải đi tìm: bộ đếm không còn
# CHIA SẺ giữa các instance. Vì vậy `desired_count` của service bị khoá ở 1.
# Muốn chạy nhiều task thì DỰNG LẠI khối này TRƯỚC KHI nâng số đó.
#
# ⚠️ Khi dựng lại, PHẢI dùng `aws_elasticache_replication_group`, KHÔNG dùng
# `aws_elasticache_cluster` — đo được 18/08/2026 bằng một lần apply hỏng:
#     InvalidParameterValue: This API doesn't support Valkey engine.
#     Please use CreateReplicationGroup API for Valkey cluster creation.
# `aws_elasticache_cluster` gọi CreateCacheCluster, mà API đó không nhận Valkey.
# Ràng buộc này chỉ sống ở tầng API của AWS, không có trong schema provider ⇒
# `terraform validate` VÀ `terraform plan` đều XANH với bản sai. Bản đầy đủ đã
# chạy được nằm trong lịch sử git, commit trước 27/08/2026.

# ─── S3: ảnh gốc ──────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "raw" {
  bucket = "${var.project}-raw-${data.aws_caller_identity.current.account_id}"
}

data "aws_caller_identity" "current" {}

# Block public access TOÀN PHẦN — PLAN_DEPLOYMENT §1. Ảnh ra ngoài qua
# CloudFront + OAC (`cdn.tf`, dựng 27/08/2026); app ghi bằng presigned POST ký
# bằng IAM task role. Bốn cờ này GIỮ NGUYÊN kể cả sau khi có CDN — đó chính là
# điểm của OAC: không có đường nào đọc bucket ngoài distribution đã khai.
resource "aws_s3_bucket_public_access_block" "raw" {
  bucket                  = aws_s3_bucket.raw.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "raw" {
  bucket = aws_s3_bucket.raw.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CORS: trình duyệt POST thẳng lên S3 bằng presigned POST (uploads.service.ts).
#
# 🔴 `allowed_origins = ["*"]` chứ không phải `[var.web_url]` — 27/08/2026.
#
# Vì sao đổi: origin của web là `http://<IP task>:3000`, mà IP chỉ biết SAU khi
# task chạy và ĐỔI mỗi lần task được thay. Điền giá trị tĩnh vào đây thì nó
# đúng được đúng một lần deploy rồi sai, và triệu chứng là upload ảnh hỏng với
# một lỗi CORS ở phía trình duyệt — không có log nào ở API hay S3 nói gì.
#
# Vì sao chấp nhận được, chứ không phải "mở cho tiện": CORS ở S3 chỉ quyết định
# trình duyệt có ĐỌC ĐƯỢC PHẢN HỒI hay không; nó KHÔNG phải lớp xác thực. Muốn
# ghi vào bucket này vẫn phải có chữ ký presigned POST còn hạn (5 phút), mà chữ
# ký đó chỉ do `POST /uploads/presigned-url` cấp sau khi qua AuthGuard. Còn
# ĐỌC thì bucket đang chặn công khai đủ 4 cờ — mọi lượt đọc đi qua CloudFront.
# Nên một origin lạ gọi tới đây cũng không làm được gì mà nó chưa được cấp phép.
#
# ⚠️ SIẾT LẠI thành origin cố định ngay khi có ALB/domain.
resource "aws_s3_bucket_cors_configuration" "raw" {
  bucket = aws_s3_bucket.raw.id
  cors_rule {
    allowed_methods = ["PUT", "POST", "GET"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}
