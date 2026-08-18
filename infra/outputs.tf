# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  outputs.tf                                                               ║
# ║  Địa chỉ công khai KHÔNG lấy được từ Terraform: không có ALB thì IP nằm    ║
# ║  trên ENI của task, mà task do ECS tạo ra sau khi apply xong. Lấy bằng     ║
# ║  lệnh ở README §4 — cố ý không dựng data source đọc ENI, vì nó sẽ trả về   ║
# ║  giá trị cũ ngay lần task được thay và làm người đọc tin nhầm.             ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

output "ecr_api_url" {
  description = "Đích docker push cho image API."
  value       = aws_ecr_repository.this["api"].repository_url
}

output "ecr_web_url" {
  description = "Đích docker push cho image Web."
  value       = aws_ecr_repository.this["web"].repository_url
}

output "rds_address" {
  description = "Host Postgres (chỉ nối được từ trong VPC)."
  value       = aws_db_instance.main.address
}

output "redis_address" {
  description = "Host Redis (chỉ nối được từ trong VPC)."
  value       = aws_elasticache_cluster.main.cache_nodes[0].address
}

output "s3_raw_bucket" {
  description = "Bucket ảnh gốc."
  value       = aws_s3_bucket.raw.bucket
}

output "ecs_cluster" {
  description = "Tên cluster, dùng cho các lệnh aws ecs ở README."
  value       = aws_ecs_cluster.main.name
}

output "subnet_ids" {
  description = "Subnet dùng cho lệnh chạy task migration one-off."
  value       = data.aws_subnets.default.ids
}

output "api_security_group" {
  description = "SG dùng cho lệnh chạy task migration one-off."
  value       = aws_security_group.api.id
}
