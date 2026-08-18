# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  network.tf — default VPC + chuỗi security group                          ║
# ║                                                                           ║
# ║  §8.F: nấc 0 dùng được DEFAULT VPC (đã có sẵn 2+ public subnet).           ║
# ║  KHÔNG dựng NAT Gateway — tiết kiệm ~$32/tháng; task nằm ở public subnet   ║
# ║  nên tự có đường ra internet để gọi Google tokeninfo / SES.                ║
# ║                                                                           ║
# ║  🔴 KHÁC thiết kế đích ở MỘT điểm, có chủ ý: đợt này KHÔNG có ALB, nên     ║
# ║     cổng ứng dụng phải mở từ internet thay vì "chỉ từ ALB-SG". Đổi lại     ║
# ║     tiết kiệm ~$18/tháng (29% tổng chi phí). Hệ quả phải biết:             ║
# ║       • Không có TLS termination ⇒ chạy HTTP trần.                          ║
# ║       • Không có health check tự động của target group.                    ║
# ║     Khi thêm ALB: đổi 2 rule ingress dưới thành `security_groups = [alb]`. ║
# ║                                                                           ║
# ║  Tầng DỮ LIỆU vẫn khoá đúng thiết kế: RDS và Redis chỉ nhận từ API-SG,     ║
# ║  không bao giờ từ internet — kể cả khi subnet là public.                   ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ─── API ──────────────────────────────────────────────────────────────────────

resource "aws_security_group" "api" {
  name        = "${var.project}-api-sg"
  description = "Task API. Tam thoi nhan 4000 tu internet vi chua co ALB."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "GraphQL + REST + WebSocket. Doi sang security_groups=[alb] khi them ALB."
    from_port   = 4000
    to_port     = 4000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Ra internet: keo image, goi Google tokeninfo, gui SES."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ─── Web ──────────────────────────────────────────────────────────────────────

resource "aws_security_group" "web" {
  name        = "${var.project}-web-sg"
  description = "Task Web (Next.js standalone)."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP tu internet."
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ─── Postgres ─────────────────────────────────────────────────────────────────

resource "aws_security_group" "rds" {
  name        = "${var.project}-rds-sg"
  description = "Postgres. CHI nhan tu API-SG, khong bao gio tu internet."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Postgres chi tu task API."
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
}

# ─── Redis ────────────────────────────────────────────────────────────────────

resource "aws_security_group" "redis" {
  name        = "${var.project}-redis-sg"
  description = "Redis. CHI nhan tu API-SG."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Redis chi tu task API."
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
}
