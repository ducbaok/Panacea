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

variable "api_cpu" {
  description = "CPU cho task API (đơn vị 1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "RAM cho task API (MiB). Image API ~1.85GB nhưng RSS runtime nhỏ hơn nhiều."
  type        = number
  default     = 1024
}

variable "web_cpu" {
  description = "CPU cho task Web."
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "RAM cho task Web (MiB)."
  type        = number
  default     = 512
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

variable "redis_node_type" {
  description = "Cỡ ElastiCache. t4g = Graviton."
  type        = string
  default     = "cache.t4g.micro"
}

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
