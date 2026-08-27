# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  ecs.tf — cluster + 2 service (api, web) + 1 task migration one-off       ║
# ║                                                                           ║
# ║  KHÔNG có ALB ở đợt này ⇒ mỗi service tự mang public IP.                   ║
# ║  🔴 Hệ quả phải biết: IP/DNS công khai ĐỔI mỗi lần task được thay. Muốn    ║
# ║     địa chỉ ổn định thì phải thêm ALB (hoặc Route 53 + script cập nhật).   ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

resource "aws_ecs_cluster" "main" {
  name = "${var.project}-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled" # bật là tốn tiền CloudWatch; để dành HT-8
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project}-api"
  retention_in_days = 14 # đừng để mặc định "never expire" — log tích luỹ là tiền
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.project}-web"
  retention_in_days = 14
}

# ─── Task definition: API ─────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "api"
    image     = "${aws_ecr_repository.this["api"].repository_url}:latest"
    essential = true

    portMappings = [{ containerPort = 4000, protocol = "tcp" }]

    environment = [
      # 🔴 NODE_ENV=production BẮT BUỘC: ở development, PrismaService bật
      #    log:['query'] và in MỌI câu SQL ⇒ vừa tốn tiền CloudWatch vừa rò rỉ
      #    dữ liệu người dùng ra log (HT-8).
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "4000" },
      # 🔴 Thiếu WEB_URL ⇒ web production bị CORS chặn sạch (lỗ hổng #5 §1).
      { name = "WEB_URL", value = var.web_url },
      { name = "APP_BASE_URL", value = var.web_url },
      { name = "AWS_REGION", value = var.region },
      { name = "S3_BUCKET_NAME", value = aws_s3_bucket.raw.bucket },
      { name = "S3_PROCESSED_BUCKET", value = aws_s3_bucket.raw.bucket },
      # 27/08/2026 — CDN đã dựng thật (cdn.tf). API dùng giá trị này để (a) ghép
      # `publicUrl` trả về cho client sau presigned POST và (b) cho chính domain
      # đó vào whitelist của createPin. Cả hai ở `common/media/media-host.util.ts`.
      { name = "CLOUDFRONT_DOMAIN", value = aws_cloudfront_distribution.media.domain_name },
      { name = "GOOGLE_CLIENT_ID", value = var.google_client_id },
      { name = "FIREBASE_SERVICE_ACCOUNT", value = "{}" },
      # 🔴 Thiếu MAIL_* ⇒ MailService rơi về nhánh console.log: token xác minh
      #    email và token đặt lại mật khẩu chỉ nằm trong CloudWatch, người dùng
      #    KHÔNG BAO GIỜ nhận được. Hai luồng đó đã implement và có phép verify,
      #    nên đây là mất tính năng thật chứ không phải thiếu sót thẩm mỹ.
      { name = "MAIL_HOST", value = var.mail_host },
      { name = "MAIL_PORT", value = tostring(var.mail_port) },
      { name = "MAIL_FROM", value = var.mail_from },
    ]

    secrets = [
      for k in local.api_secret_keys :
      { name = k, valueFrom = aws_ssm_parameter.app[k].arn }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "api"
      }
    }

    # Health check trỏ /health (dựng ở HT-3). startPeriod 30s > boot đo được
    # ~16s, để dư (§8.H). Không có ALB nên đây là lớp canh sức khoẻ DUY NHẤT.
    # Dùng node thay curl: image node:24-bookworm-slim KHÔNG có sẵn curl/wget.
    healthCheck = {
      command     = ["CMD-SHELL", local.api_healthcheck_cmd]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
}

locals {
  # Tách ra local để tránh địa ngục thoát dấu nháy khi nhúng thẳng vào jsonencode.
  api_healthcheck_cmd = "node -e \"require('http').get('http://127.0.0.1:4000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""
}

resource "aws_ecs_service" "api" {
  name            = "${var.project}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true # bắt buộc: không có NAT thì đây là đường ra internet
  }

  # Zero-downtime với 1 task (§8.H).
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # Task mới fail health check ⇒ tự quay về bản cũ thay vì loop chết.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # CI đẩy image mới bằng `aws ecs update-service --force-new-deployment`, không
  # qua Terraform ⇒ bỏ qua thay đổi task_definition để hai bên không giành nhau.
  lifecycle {
    ignore_changes = [task_definition]
  }
}

# ─── Task definition: Web ─────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.project}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "web"
    image     = "${aws_ecr_repository.this["web"].repository_url}:latest"
    essential = true

    portMappings = [{ containerPort = 3000, protocol = "tcp" }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      # ⚠️ NEXT_PUBLIC_* được nhúng lúc BUILD chứ không phải lúc chạy. Đặt ở đây
      #    chỉ tác dụng cho code chạy phía server. Muốn đổi cho phía trình duyệt
      #    thì phải BUILD LẠI image với đúng giá trị — xem README §6.
      { name = "NEXT_PUBLIC_API_URL", value = var.api_public_url },
    ]

    secrets = [
      { name = "AUTH_SECRET", valueFrom = aws_ssm_parameter.app["AUTH_SECRET"].arn }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  name            = "${var.project}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = true
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}

# ─── Migration: task one-off, KHÔNG phải service ──────────────────────────────
# HT-6 luật cứng: migration chạy như MỘT task riêng, không nhét vào lệnh khởi
# động của API — nhét vào thì N task cùng chạy migration cùng lúc.
# Cách gọi: infra/README.md §5.

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.project}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = "${aws_ecr_repository.this["api"].repository_url}:latest"
    essential = true

    # CHỈ `migrate deploy`. Không `migrate dev`, không `db push` — vĩnh viễn
    # (PLAN_HATANG §HT-6). Cũng KHÔNG chạy `db:seed`: seed tạo 5 tài khoản
    # mật khẩu `password123` và xoá sạch dữ liệu cũ trước khi ghi.
    command = [
      "npx", "--yes", "prisma", "migrate", "deploy",
      "--schema", "packages/database/prisma/schema.prisma"
    ]

    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_ssm_parameter.app["DATABASE_URL"].arn }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "migrate"
      }
    }
  }])
}
