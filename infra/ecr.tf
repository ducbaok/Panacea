# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  ecr.tf — 2 registry + lifecycle policy                                   ║
# ║                                                                           ║
# ║  🔴 LIFECYCLE POLICY LÀ BẮT BUỘC, KHÔNG PHẢI TÙY CHỌN (§8.G).             ║
# ║     Image API đo được 1.85 GB × $0.10/GB-tháng ⇒ cứ 20 lần push mà không  ║
# ║     dọn là +$3.7/tháng, âm thầm, mãi mãi. Đây là dòng chi phí DUY NHẤT     ║
# ║     tự lớn mà không cần traffic nào.                                       ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

locals {
  ecr_repos = ["api", "web"]

  # Giữ 10 image gần nhất. Tag theo git SHA (kỷ luật §5.8) nên "gần nhất" =
  # "mới push nhất", không phụ thuộc thứ tự chữ cái của tag.
  ecr_lifecycle = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Giu 10 image gan nhat, xoa phan con lai."
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_repository" "this" {
  for_each = toset(local.ecr_repos)

  name = "${var.project}-${each.value}"

  # Quét lỗ hổng khi push — miễn phí ở mức basic.
  image_scanning_configuration {
    scan_on_push = true
  }

  # MUTABLE để tag `latest` đẩy lại được. Nếu sau này CI chỉ dùng git SHA thì
  # đổi sang IMMUTABLE cho chắc — nhưng khi đó `latest` sẽ không đẩy lại được.
  image_tag_mutability = "MUTABLE"
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each = aws_ecr_repository.this

  repository = each.value.name
  policy     = local.ecr_lifecycle
}
