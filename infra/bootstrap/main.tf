# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  bootstrap — CHẠY MỘT LẦN, TRƯỚC infra/ chính                             ║
# ║                                                                           ║
# ║  Bài toán gà-và-trứng (§8.I): state của Terraform phải nằm ngoài máy dev,  ║
# ║  nhưng bucket giữ state thì không thể tự quản chính nó. Nên thư mục này    ║
# ║  dùng backend LOCAL, dựng đúng 2 resource, rồi thôi — không đụng lại.      ║
# ║                                                                           ║
# ║  Chạy:                                                                     ║
# ║    cd infra/bootstrap && terraform init && terraform apply                 ║
# ║  Rồi mở infra/versions.tf, bỏ comment khối `backend "s3"`, điền account id,║
# ║  và chạy `terraform init -migrate-state` ở infra/.                          ║
# ║                                                                           ║
# ║  ⚠️ terraform.tfstate của CHÍNH thư mục này nằm trên đĩa và bị .gitignore  ║
# ║     chặn. Mất nó không nghiêm trọng: 2 resource này import lại được.       ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "antigravity"
      ManagedBy = "terraform-bootstrap"
    }
  }
}

variable "region" {
  type    = string
  default = "ap-southeast-1"
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "tfstate" {
  bucket = "antigravity-tfstate-${data.aws_caller_identity.current.account_id}"

  # Bucket state là thứ KHÔNG được lỡ tay xoá.
  lifecycle {
    prevent_destroy = true
  }
}

# Versioning: state hỏng thì còn đường lùi về bản trước.
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# State chứa giá trị của mọi biến sensitive ở dạng ĐỌC ĐƯỢC ⇒ chặn public tuyệt đối.
resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Khoá chống hai người apply cùng lúc.
resource "aws_dynamodb_table" "tflock" {
  name         = "antigravity-tflock"
  billing_mode = "PAY_PER_REQUEST" # gần như $0 ở tần suất này
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "backend_config" {
  description = "Dan vao khoi backend \"s3\" o infra/versions.tf"
  value       = <<-EOT
    bucket         = "${aws_s3_bucket.tfstate.bucket}"
    key            = "prod/terraform.tfstate"
    region         = "${var.region}"
    dynamodb_table = "${aws_dynamodb_table.tflock.name}"
    encrypt        = true
  EOT
}
