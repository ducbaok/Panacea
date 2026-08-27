# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  data.tf — RDS Postgres + ElastiCache Redis                               ║
# ║                                                                           ║
# ║  Cả hai đều `publicly_accessible = false` — nằm trong VPC, kể cả khi       ║
# ║  subnet là public (§8.F). Máy dev muốn nối DB prod thì port-forward qua    ║
# ║  `aws ssm start-session`, ĐỪNG mở 5432 ra internet.                        ║
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

# ─── Redis ────────────────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project}-redis-subnets"
  subnet_ids = data.aws_subnets.default.ids
}

# 🔴 PHẢI dùng `aws_elasticache_replication_group`, KHÔNG dùng
# `aws_elasticache_cluster` — đo được 18/08/2026 bằng một lần apply hỏng:
#   InvalidParameterValue: This API doesn't support Valkey engine.
#   Please use CreateReplicationGroup API for Valkey cluster creation.
# `aws_elasticache_cluster` gọi CreateCacheCluster, mà API đó không nhận Valkey.
# ⚠️ `terraform validate` VÀ `terraform plan` đều xanh với bản sai — ràng buộc
#    này chỉ sống ở tầng API của AWS, không có trong schema provider.
resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.project}-redis"
  description          = "Antigravity - pubsub, khoa brute-force, debounce tracking"

  # Valkey thay Redis OSS: tương thích giao thức, rẻ hơn ~20% (đòn bẩy giá §7.4).
  # ioredis của app nói chuyện bình thường, không đổi dòng code nào.
  engine         = "valkey"
  engine_version = "7.2"
  node_type      = var.redis_node_type
  port           = 6379

  # Một node duy nhất ⇒ không bật failover (bật là đòi ≥2 node = gấp đôi tiền).
  num_cache_clusters         = 1
  automatic_failover_enabled = false

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  # ⚠️ KHÔNG bật transit encryption: bật là REDIS_URL phải đổi sang `rediss://`
  # và phải sửa cả 3 chỗ app dùng Redis. Để dành một đợt riêng.
  transit_encryption_enabled = false
  at_rest_encryption_enabled = true
}

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

# CORS: trình duyệt PUT thẳng lên S3 bằng presigned POST (uploads.service.ts).
resource "aws_s3_bucket_cors_configuration" "raw" {
  bucket = aws_s3_bucket.raw.id
  cors_rule {
    allowed_methods = ["PUT", "POST", "GET"]
    allowed_origins = [var.web_url]
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}
