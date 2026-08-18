# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  versions.tf — provider + backend                                         ║
# ║                                                                           ║
# ║  BACKEND: state KHÔNG được nằm trên máy dev (docs/phan-tich-ha-tang §8.I). ║
# ║  Nhưng bucket/table giữ state thì không thể tự quản chính nó ⇒ bài toán    ║
# ║  gà-và-trứng. Cách tháo: `infra/bootstrap/` dựng 2 resource đó bằng        ║
# ║  backend LOCAL một lần, xong mới bỏ comment khối `backend "s3"` dưới đây   ║
# ║  và chạy `terraform init -migrate-state`.                                  ║
# ║                                                                           ║
# ║  ⚠️ Khối backend cố ý để COMMENT: chưa bootstrap mà init sẽ hỏng, và       ║
# ║     người đọc dễ tưởng là lỗi. Xem `infra/README.md` §2.                    ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Ghim theo dòng 5.x — đã ổn định lâu. Nâng lên 6.x được, nhưng hãy nâng
      # trong một lần thay đổi RIÊNG để nếu vỡ thì biết vỡ vì provider.
      version = "~> 5.0"
    }
  }

  # ─── Bỏ comment SAU KHI chạy xong infra/bootstrap ───────────────────────────
  # backend "s3" {
  #   bucket         = "antigravity-tfstate-<ACCOUNT_ID>"
  #   key            = "prod/terraform.tfstate"
  #   region         = "ap-southeast-1"
  #   dynamodb_table = "antigravity-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  # Tag mặc định cho MỌI resource — §8.B: thiếu tag thì về sau không tách nổi
  # tiền của dự án khỏi thử nghiệm khác trong cùng account.
  default_tags {
    tags = {
      Project   = "antigravity"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}
