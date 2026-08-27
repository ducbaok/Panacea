# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  network.tf — default VPC + hai security group                            ║
# ║                                                                           ║
# ║  §8.F: nấc 0 dùng được DEFAULT VPC (đã có sẵn 2+ public subnet).           ║
# ║  KHÔNG dựng NAT Gateway — tiết kiệm ~$32/tháng; task nằm ở public subnet   ║
# ║  nên tự có đường ra internet để gọi Google tokeninfo / SMTP / kéo image.   ║
# ║                                                                           ║
# ║  🔴 KHÁC thiết kế đích ở MỘT điểm, có chủ ý: đợt này KHÔNG có ALB, nên     ║
# ║     cổng ứng dụng phải mở từ internet thay vì "chỉ từ ALB-SG". Đổi lại     ║
# ║     tiết kiệm $18.40/tháng (số đo từ Pricing API `ap-southeast-1`).        ║
# ║     Hệ quả phải biết:                                                     ║
# ║       • Không có TLS termination ⇒ chạy HTTP trần, mật khẩu người dùng     ║
# ║         đi qua mạng ở dạng đọc được.                                      ║
# ║       • Không có health check tự động của target group.                   ║
# ║     Khi thêm ALB: đổi 2 rule ingress dưới thành `security_groups = [alb]`. ║
# ║                                                                           ║
# ║  27/08/2026 — GỘP BA SG THÀNH MỘT. Trước đây có `api`, `web`, `redis` vì  ║
# ║  chúng là ba thứ tách rời trên mạng. Nay api + web + valkey nằm CHUNG một ║
# ║  task ⇒ chung một ENI ⇒ chung một security group, và Valkey không còn bề  ║
# ║  mặt mạng nào cả (nó chỉ nghe trên 127.0.0.1 trong network namespace của  ║
# ║  task). Một SG cho Redis lúc này sẽ là một quy tắc không gắn với gì.      ║
# ║                                                                           ║
# ║  Tầng DỮ LIỆU vẫn khoá đúng thiết kế: RDS chỉ nhận từ APP-SG, không bao   ║
# ║  giờ từ internet — kể cả khi subnet là public.                            ║
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

# ─── Task ứng dụng (api + web + valkey) ───────────────────────────────────────

resource "aws_security_group" "app" {
  name        = "${var.project}-app-sg"
  description = "Task ung dung. Tam thoi nhan 3000/4000 tu internet vi chua co ALB."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Web (Next.js standalone). Doi sang security_groups=[alb] khi them ALB."
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "GraphQL + REST + WebSocket. Doi sang security_groups=[alb] khi them ALB."
    from_port   = 4000
    to_port     = 4000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # KHÔNG có rule nào cho 6379. Valkey nghe trong network namespace của task,
  # không đi qua ENI ⇒ mở cổng đó ra là mở một cửa không cần thiết.

  egress {
    description = "Ra internet: keo image tu ECR, goi Google tokeninfo, gui SMTP."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ─── Postgres ─────────────────────────────────────────────────────────────────

resource "aws_security_group" "rds" {
  name        = "${var.project}-rds-sg"
  description = "Postgres. CHI nhan tu APP-SG, khong bao gio tu internet."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Postgres chi tu task ung dung."
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}
