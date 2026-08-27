# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  variables.tf                                                             ║
# ║  Giá trị thật đặt ở `terraform.tfvars` (KHÔNG commit — .gitignore).        ║
# ║  Xem `terraform.tfvars.example` để biết cần điền gì.                       ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

variable "region" {
  description = "Region AWS. Đã chốt ap-southeast-1 (docs/phan-tich-ha-tang §7.9)."
  type        = string
  default     = "ap-southeast-1"
}

variable "env" {
  description = "Tên môi trường, vào tag và tên resource."
  type        = string
  default     = "prod"
}

variable "project" {
  description = "Tiền tố tên resource."
  type        = string
  default     = "antigravity"
}

# ─── Cỡ máy ───────────────────────────────────────────────────────────────────
# Số lấy từ RSS đo được, không đoán — docs/phan-tich-ha-tang §3.1.

# 27/08/2026 — MỘT task duy nhất chứa cả ba container (api · web · valkey), nên
# chỉ còn một cặp cpu/memory thay cho hai cặp api_*/web_* trước đây.
#
# 💰 Giá thật ap-southeast-1 (Pricing API, 27/08): vCPU $0.05056/giờ =
# $36.91/tháng · RAM $0.00553/giờ/GB = $4.04/tháng/GB.
#   ⇒ 512 CPU + 2048 MiB = 0.5 × 36.91 + 2 × 4.04 = **$26.54/tháng**.
# So với bản 2 task cũ (API 0.5vCPU/1GB + Web 0.25vCPU/0.5GB = $33.74) thì rẻ
# hơn $7.20, và tiết kiệm thêm $3.65 vì chỉ còn MỘT địa chỉ IPv4 công khai.
#
# ⚠️ Fargate chỉ nhận một số CẶP cpu/memory hợp lệ: với 512 CPU thì memory phải
# là 1024–4096 MiB, bước 1024. Đặt 1536 hay 2560 là apply đỏ ở tận resource
# task definition, kèm thông báo không nói rõ cặp nào hợp lệ.
#
# ⚠️ Fargate KHÔNG cho burst CPU: 512 là trần cứng chia cho cả ba container.
# Không phải "trung bình 0.5 vCPU" mà là "không bao giờ quá 0.5 vCPU".
variable "app_cpu" {
  description = "CPU cho task ứng dụng, dùng chung cho api + web + valkey (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "app_memory" {
  description = "RAM cho task ứng dụng (MiB). Chia mềm: api 900 · web 700 · valkey 256."
  type        = number
  default     = 2048
}

variable "db_instance_class" {
  description = "Cỡ RDS. t4g = Graviton, rẻ hơn t3 cùng cấu hình (đòn bẩy giá §7.3)."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Dung lượng RDS (GB). Tối thiểu 20 cho gp3."
  type        = number
  default     = 20
}

# `redis_node_type` đã gỡ 27/08/2026 cùng với ElastiCache — Valkey nay là
# container phụ trong task ứng dụng. Xem khối §Redis ở `data.tf` để biết cái
# giá của đổi này và điều kiện dựng lại.

# ─── Bí mật ứng dụng ──────────────────────────────────────────────────────────
# Đưa vào SSM Parameter Store (SecureString) chứ không phải Secrets Manager —
# Parameter Store standard tier MIỄN PHÍ, Secrets Manager $0.40/secret/tháng
# (đòn bẩy giá §7.7). Với ~8 secret thì đó là ~$3.2/tháng không cần tiêu.
#
# ⚠️ KHÔNG đặt giá trị thật vào đây hay vào tfvars đã commit.
#    Nạp qua biến môi trường: TF_VAR_backend_jwt_secret=... terraform apply
#    hoặc điền tay một lần trong Console rồi bỏ khỏi Terraform.

variable "db_password" {
  description = "Mật khẩu master của RDS."
  type        = string
  sensitive   = true
}

variable "backend_jwt_secret" {
  description = "BACKEND_JWT_SECRET — NestJS ký/verify access token. Tối thiểu 32 ký tự."
  type        = string
  sensitive   = true
}

variable "refresh_token_secret" {
  description = "REFRESH_TOKEN_SECRET. Tối thiểu 32 ký tự."
  type        = string
  sensitive   = true
}

variable "auth_secret" {
  description = <<-EOT
    AUTH_SECRET — dùng CHUNG giữa apps/api và apps/web.
    🔴 Hai bên PHẢI giống hệt nhau, nếu không POST /auth/exchange từ chối mọi
    request và đăng nhập OAuth chết câm. Tối thiểu 32 ký tự.
  EOT
  type        = string
  sensitive   = true
}

variable "internal_api_secret" {
  description = "INTERNAL_API_SECRET — header x-internal-secret cho /internal/*. Tối thiểu 16 ký tự."
  type        = string
  sensitive   = true
}

variable "google_client_id" {
  description = "GOOGLE_CLIENT_ID. Bắt buộc có mặt (Joi), giá trị giả cũng boot được."
  type        = string
  default     = "not-configured.apps.googleusercontent.com"
}

variable "web_url" {
  description = <<-EOT
    WEB_URL — origin được whitelist CORS ở API.
    🔴 Thiếu/sai thì web production bị CORS chặn sạch (lỗ hổng #5, PLAN_HATANG §1).
    Chưa có domain thì điền DNS name công khai của task Web sau lần apply đầu.
  EOT
  type        = string
  default     = "http://localhost:3000"
}

variable "api_public_url" {
  description = <<-EOT
    URL công khai của API, dùng cho NEXT_PUBLIC_API_URL của task Web.
    🔴 Bài toán con-gà-quả-trứng có thật ở đợt KHÔNG-ALB: địa chỉ công khai chỉ
    biết SAU khi task API chạy, và nó ĐỔI mỗi lần task được thay. Quy trình:
    apply lần 1 → đọc output `api_public_ip` → điền vào đây → apply lần 2.
    Thêm ALB sẽ xoá hẳn vòng lặp này.
  EOT
  type        = string
  default     = "http://127.0.0.1:4000"
}

# ─── SMTP (27/08/2026) ────────────────────────────────────────────────────────
# Bảng env §6 của PLAN_DEPLOYMENT khai MAIL_*, nhưng task definition trước đây
# không nạp dòng nào. Hệ quả đo được: `MailService` rơi về nhánh console.log,
# nên token XÁC MINH EMAIL và token ĐẶT LẠI MẬT KHẨU chỉ tồn tại trong log
# CloudWatch — người dùng không bao giờ kích hoạt được tài khoản.
#
# Để trống CẢ HAI biến user/password nếu chưa có SMTP: hạ tầng vẫn dựng, chỉ mất
# tính năng gửi mail (xem `local.mail_enabled` ở iam.tf).

variable "mail_host" {
  description = "SMTP host. Bỏ trống nếu chưa có."
  type        = string
  default     = ""
}

variable "mail_port" {
  description = "SMTP port (587 = STARTTLS)."
  type        = number
  default     = 587
}

variable "mail_from" {
  description = "Địa chỉ hiển thị ở trường From."
  type        = string
  default     = "Antigravity <noreply@antigravity.app>"
}

variable "mail_user" {
  description = "Tài khoản SMTP. Rỗng ⇒ tắt gửi mail."
  type        = string
  default     = ""
  sensitive   = true
}

variable "mail_password" {
  description = "Mật khẩu/app-password SMTP. Rỗng ⇒ tắt gửi mail."
  type        = string
  default     = ""
  sensitive   = true
}
