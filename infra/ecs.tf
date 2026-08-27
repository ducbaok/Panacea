# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  ecs.tf — MỘT task chứa ba container (api · web · valkey) + task migrate   ║
# ║                                                                           ║
# ║  🔴 ĐỔI KIẾN TRÚC 27/08/2026 — đọc trước khi sửa gì ở đây.                ║
# ║  Bản trước: 2 service (api, web) + ElastiCache riêng = ~$83/tháng (số đo  ║
# ║  từ Pricing API `ap-southeast-1`, KHÔNG phải ước tính ~$70 trong tài liệu ║
# ║  cũ). Bản này gộp còn ~$58 bằng ba đòn bẩy, mỗi cái có cái giá của nó:    ║
# ║                                                                           ║
# ║   1. Valkey thành container PHỤ thay vì ElastiCache   −$14.02/tháng       ║
# ║   2. API 0.5 → 0.25 vCPU (gộp chung task)             −$9.23/tháng        ║
# ║   3. Web chung task với API ⇒ MỘT địa chỉ IP          −$3.65/tháng        ║
# ║                                                                           ║
# ║  🔴🔴 RÀNG BUỘC CỨNG SINH RA TỪ ĐÒN BẨY 1: `desired_count` PHẢI = 1.      ║
# ║  Redis ở đây giữ bộ đếm chống brute-force (`login:fail:*`, `login:lock:*`)║
# ║  và hạn mức tạo pin (`pincreate:*`). Chúng chỉ có tác dụng khi MỌI instance║
# ║  đọc chung MỘT bộ đếm. Nâng lên 2 task là mỗi task có Valkey riêng ⇒ kẻ   ║
# ║  tấn công chỉ cần xoay vòng giữa các task là vô hiệu hoá hạn mức, và      ║
# ║  KHÔNG CÓ GÌ BÁO LỖI — hệ thống vẫn xanh, chỉ là hết được bảo vệ. Đây     ║
# ║  đúng lỗ hổng dự án đã vá ở P1 Đợt 7 và nay tự nguyện nhận lại có điều    ║
# ║  kiện. Muốn chạy >1 task: DỰNG LẠI ElastiCache TRƯỚC (xem `data.tf`).    ║
# ║                                                                           ║
# ║  Hệ quả thứ hai: Valkey ghi trên đĩa ephemeral và tắt hẳn persistence ⇒   ║
# ║  mọi bộ đếm reset mỗi lần deploy. Chấp nhận được vì cả ba đều có TTL      ║
# ║  ngắn, nhưng nghĩa là "đang bị khoá 900s" sẽ được gỡ sớm bởi một lần      ║
# ║  deploy — đừng đi tìm bug khi thấy hiện tượng đó.                         ║
# ║                                                                           ║
# ║  KHÔNG có ALB ⇒ task tự mang public IP, và IP ĐỔI mỗi lần task được thay. ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

resource "aws_ecs_cluster" "main" {
  name = "${var.project}-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled" # bật là tốn tiền CloudWatch; để dành HT-8
  }
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.project}-app"
  retention_in_days = 14 # đừng để mặc định "never expire" — log tích luỹ là tiền
}

# ─── Task definition: api + web + valkey trong CÙNG một task ──────────────────
#
# Ba container chung một task nghĩa là chung một network namespace: chúng gọi
# nhau qua `127.0.0.1`, không qua mạng VPC. Đó là lý do `REDIS_URL` trỏ
# localhost và không cần security group nào cho Redis nữa.

resource "aws_ecs_task_definition" "app" {
  family                   = "${var.project}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.app_cpu
  memory                   = var.app_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    # ── Valkey ────────────────────────────────────────────────────────────────
    {
      name  = "valkey"
      image = local.valkey_image
      # `essential = true`: Valkey chết thì cả task chết và được thay. Để
      # `false` nghĩa là API chạy tiếp với Redis đã chết — limiter fail-OPEN
      # (đúng thiết kế) nên KHÔNG có gì đỏ, hệ thống chỉ lặng lẽ hết bảo vệ.
      essential = true

      # `--save ""` + `--appendonly no`: TẮT HẲN persistence. Đĩa của Fargate là
      # ephemeral nên ghi xuống cũng mất; giữ persistence chỉ tốn I/O và làm
      # container khởi động chậm vì nạp lại file AOF vô nghĩa.
      command = ["redis-server", "--save", "", "--appendonly", "no", "--maxmemory", "192mb", "--maxmemory-policy", "allkeys-lru"]

      memoryReservation = 256

      healthCheck = {
        command     = ["CMD-SHELL", "redis-cli ping | grep -q PONG"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "valkey"
        }
      }
    },

    # ── API ───────────────────────────────────────────────────────────────────
    {
      name      = "api"
      image     = "${aws_ecr_repository.this["api"].repository_url}:latest"
      essential = true

      # Chờ Valkey HEALTHY chứ không chỉ START. `commandTimeout: 500` ở factory
      # REDIS_CLIENT làm API fail-open nhanh khi Redis chưa sẵn sàng, nên thiếu
      # ràng buộc này thì task vẫn lên — nhưng vài request đầu chạy KHÔNG có
      # limiter, và đó là trạng thái không ai nhìn thấy để mà sửa.
      dependsOn = [{ containerName = "valkey", condition = "HEALTHY" }]

      portMappings = [{ containerPort = 4000, protocol = "tcp" }]

      memoryReservation = 900

      environment = [
        # 🔴 NODE_ENV=production BẮT BUỘC: ở development, PrismaService bật
        #    log:['query'] và in MỌI câu SQL ⇒ vừa tốn tiền CloudWatch vừa rò rỉ
        #    dữ liệu người dùng ra log (HT-8).
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "4000" },
        # Cùng task ⇒ cùng network namespace ⇒ localhost. Không còn là bí mật
        # nên không cần đi qua SSM như hồi còn ElastiCache.
        { name = "REDIS_URL", value = "redis://127.0.0.1:6379" },
        # 🔴 Thiếu WEB_URL ⇒ web production bị CORS chặn sạch (lỗ hổng #5 §1).
        { name = "WEB_URL", value = var.web_url },
        { name = "APP_BASE_URL", value = var.web_url },
        { name = "AWS_REGION", value = var.region },
        { name = "S3_BUCKET_NAME", value = aws_s3_bucket.raw.bucket },
        { name = "S3_PROCESSED_BUCKET", value = aws_s3_bucket.raw.bucket },
        # CDN đã dựng thật (cdn.tf). API dùng giá trị này để (a) ghép `publicUrl`
        # trả về cho client sau presigned POST và (b) cho chính domain đó vào
        # whitelist của createPin. Cả hai ở `common/media/media-host.util.ts`.
        { name = "CLOUDFRONT_DOMAIN", value = aws_cloudfront_distribution.media.domain_name },
        { name = "GOOGLE_CLIENT_ID", value = var.google_client_id },
        { name = "FIREBASE_SERVICE_ACCOUNT", value = "{}" },
        # 🔴 Thiếu MAIL_* ⇒ MailService rơi về nhánh console.log: token xác minh
        #    email và token đặt lại mật khẩu chỉ nằm trong CloudWatch, người dùng
        #    KHÔNG BAO GIỜ nhận được.
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
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "api"
        }
      }

      # Health check trỏ /health (dựng ở HT-3). startPeriod 60s: boot đo được
      # ~16s ở 0.5 vCPU, nhưng task này chỉ có 0.25 vCPU hiệu dụng cho API nên
      # để dư gấp ba. Không có ALB nên đây là lớp canh sức khoẻ DUY NHẤT.
      # Dùng node thay curl: image node:24-bookworm-slim KHÔNG có sẵn curl/wget.
      healthCheck = {
        command     = ["CMD-SHELL", local.api_healthcheck_cmd]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    },

    # ── Web ───────────────────────────────────────────────────────────────────
    {
      name      = "web"
      image     = "${aws_ecr_repository.this["web"].repository_url}:latest"
      essential = true

      portMappings = [{ containerPort = 3000, protocol = "tcp" }]

      memoryReservation = 700

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" },
        # ⚠️ NEXT_PUBLIC_* được nhúng lúc BUILD chứ không phải lúc chạy. Đặt ở
        #    đây chỉ tác dụng cho code chạy phía server. Muốn đổi cho phía trình
        #    duyệt thì phải BUILD LẠI image Web — xem apps/web/Dockerfile.
        { name = "NEXT_PUBLIC_API_URL", value = var.api_public_url },
        # Render phía server gọi API qua localhost: không ra internet, không
        # phụ thuộc IP công khai, và không tính tiền data transfer.
        { name = "EXCHANGE_ENDPOINT", value = "http://127.0.0.1:4000/auth/exchange" },
      ]

      secrets = [
        { name = "AUTH_SECRET", valueFrom = aws_ssm_parameter.app["AUTH_SECRET"].arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "web"
        }
      }
    },
  ])
}

locals {
  # Tách ra local để tránh địa ngục thoát dấu nháy khi nhúng thẳng vào jsonencode.
  api_healthcheck_cmd = "node -e \"require('http').get('http://127.0.0.1:4000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""

  # ECR Public chứ KHÔNG phải Docker Hub: Docker Hub chặn theo hạn mức pull ẩn
  # danh, và task Fargate kéo image bằng IP công khai dùng chung của AWS nên
  # rất dễ chạm trần. Biểu hiện là `CannotPullContainerError: toomanyrequests`
  # xuất hiện NGẪU NHIÊN ở một lần deploy nào đó, không tái lập được.
  valkey_image = "public.ecr.aws/docker/library/redis:7-alpine"
}

resource "aws_ecs_service" "app" {
  name            = "${var.project}-app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  launch_type     = "FARGATE"

  # 🔴🔴 KHÔNG NÂNG SỐ NÀY. Xem khối đầu file: Valkey là container phụ trong
  # chính task này, nên 2 task = 2 bộ đếm rời nhau = limiter chống brute-force
  # và hạn mức tạo pin mất tác dụng, IM LẶNG. Cần scale thì dựng ElastiCache
  # lại trước rồi mới đổi số này.
  desired_count = 1

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true # bắt buộc: không có NAT thì đây là đường ra internet
  }

  # Với desired_count = 1, `minimum_healthy_percent = 100` khiến ECS phải dựng
  # task mới TRƯỚC khi hạ task cũ ⇒ trong lúc deploy có hai task sống, và mỗi
  # task có Valkey riêng. Cửa sổ đó ngắn (~1-2 phút) và chỉ mở lúc deploy.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # Task mới fail health check ⇒ tự quay về bản cũ thay vì loop chết.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Đẩy image mới bằng `aws ecs update-service --force-new-deployment`, không
  # qua Terraform ⇒ bỏ qua thay đổi task_definition để hai bên không giành nhau.
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
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "migrate"
      }
    }
  }])
}
