# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  iam.tf — hai role, đừng nhầm nhau                                        ║
# ║                                                                           ║
# ║  • EXECUTION role: ECS agent dùng để KÉO IMAGE và ĐỌC SECRET lúc khởi      ║
# ║    động task. Không phải quyền của code trong container.                   ║
# ║  • TASK role: quyền của CODE ĐANG CHẠY (SDK tự nhặt).                      ║
# ║                                                                           ║
# ║  🔴 §8.C: trên ECS, API KHÔNG dùng AWS_ACCESS_KEY_ID/SECRET nữa. Quyền S3  ║
# ║     đi qua TASK role. Hai biến đó chỉ còn nghĩa khi chạy local muốn thử S3 ║
# ║     thật. Ít key dài hạn = ít thứ để lộ.                                   ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ─── Execution role ───────────────────────────────────────────────────────────

resource "aws_iam_role" "execution" {
  name               = "${var.project}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Managed policy trên KHÔNG bao gồm quyền đọc SSM Parameter Store.
# Thiếu khối này thì task chết lúc khởi động với lỗi rất khó đọc
# ("ResourceInitializationError ... unable to pull secrets").
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}/*"]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-ssm-parameters"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# ─── Task role ────────────────────────────────────────────────────────────────

resource "aws_iam_role" "task" {
  name               = "${var.project}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task_s3" {
  statement {
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.raw.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.raw.arn]
  }
}

resource "aws_iam_role_policy" "task_s3" {
  name   = "raw-bucket-access"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_s3.json
}

# ─── Secrets trong SSM Parameter Store ────────────────────────────────────────
# Standard tier MIỄN PHÍ; Secrets Manager tính $0.40/secret/tháng ⇒ với 6 secret
# là ~$2.4/tháng không cần tiêu (đòn bẩy giá §7.7).

locals {
  # SMTP chỉ được nạp khi điền ĐỦ CẢ HAI. Lý do không phải thẩm mỹ:
  # `aws_ssm_parameter` TỪ CHỐI giá trị chuỗi rỗng, nên khai một secret rỗng là
  # apply đỏ. Thiếu cấu hình mail ⇒ MailService rơi về nhánh console.log như ở
  # CI — mất tính năng, nhưng không chặn cả hạ tầng.
  mail_enabled = var.mail_user != "" && var.mail_password != ""

  base_secrets = {
    BACKEND_JWT_SECRET   = var.backend_jwt_secret
    REFRESH_TOKEN_SECRET = var.refresh_token_secret
    AUTH_SECRET          = var.auth_secret
    INTERNAL_API_SECRET  = var.internal_api_secret
    DATABASE_URL         = "postgresql://${aws_db_instance.main.username}:${urlencode(var.db_password)}@${aws_db_instance.main.address}:5432/${aws_db_instance.main.db_name}"
    REDIS_URL            = "redis://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
  }

  mail_secrets = local.mail_enabled ? {
    MAIL_USER = var.mail_user
    MAIL_PASS = var.mail_password
  } : {}

  secrets = merge(local.base_secrets, local.mail_secrets)

  # Danh sách khoá mà container API nạp qua `secrets`. Suy từ chính `local.secrets`
  # để không đẻ ra bản sao thứ hai phải nhớ sửa song song — trừ AUTH_SECRET, thứ
  # duy nhất cả API lẫn Web cùng dùng nên vẫn khai riêng ở task Web.
  api_secret_keys = keys(local.secrets)
}

# ⚠️ urlencode() ở DATABASE_URL không thừa: mật khẩu chứa `@` mà không
# percent-encode thì Prisma parse sai host — đã trả giá một lần (debug_history §S7).
resource "aws_ssm_parameter" "app" {
  for_each = local.secrets

  name  = "/${var.project}/${each.key}"
  type  = "SecureString"
  value = each.value
}
