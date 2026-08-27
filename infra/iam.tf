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
    # `REDIS_URL` KHÔNG còn ở đây từ 27/08/2026. Valkey là container phụ trong
    # cùng task ⇒ giá trị là `redis://127.0.0.1:6379`, không phải bí mật, nên
    # nó nằm thẳng trong `environment` của container api (`ecs.tf`). Để lại
    # trong SSM thì vừa thừa một parameter vừa tạo hai nguồn sự thật.
  }

  mail_secrets = local.mail_enabled ? {
    MAIL_USER = var.mail_user
    MAIL_PASS = var.mail_password
  } : {}

  secrets = merge(local.base_secrets, local.mail_secrets)

  # Danh sách khoá mà container API nạp qua `secrets`. Suy từ chính `local.secrets`
  # để không đẻ ra bản sao thứ hai phải nhớ sửa song song — trừ AUTH_SECRET, thứ
  # duy nhất cả API lẫn Web cùng dùng nên vẫn khai riêng ở task Web.
  #
  # 🔴 `nonsensitive()` KHÔNG THỪA — thiếu nó là `terraform plan` ĐỎ hẳn:
  #     Sensitive values ... cannot be used as for_each arguments.
  #
  # Lý do tinh vi: một object literal như `base_secrets` giữ nhãn sensitive trên
  # TỪNG THUỘC TÍNH, nhưng `merge()` là một hàm, và hàm thì gắn nhãn lên CẢ giá
  # trị trả về. Nên `local.secrets` bị đánh dấu sensitive TOÀN BỘ, `keys()` lây
  # nhãn theo, và `for_each` từ chối. Ở đây chỉ có TÊN khoá đi qua — `MAIL_USER`,
  # `DATABASE_URL`… — không phải giá trị, nên gỡ nhãn là đúng và an toàn.
  # Giá trị vẫn giữ nguyên nhãn: xem `value` của `aws_ssm_parameter.app`.
  api_secret_keys = nonsensitive(keys(local.secrets))
}

# ⚠️ urlencode() ở DATABASE_URL không thừa: mật khẩu chứa `@` mà không
# percent-encode thì Prisma parse sai host — đã trả giá một lần (debug_history §S7).
resource "aws_ssm_parameter" "app" {
  # Lặp theo TÊN khoá, không theo cả map. Xem chú thích `api_secret_keys` bên
  # trên: lặp theo map là `plan` đỏ vì map mang nhãn sensitive.
  for_each = toset(local.api_secret_keys)

  name = "/${var.project}/${each.key}"
  type = "SecureString"
  # Tra ngược lại giá trị — chuỗi này VẪN mang nhãn sensitive nên Terraform
  # không in nó ra plan. Chỉ tên khoá là công khai.
  value = local.secrets[each.key]
}
