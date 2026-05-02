output "bucket_name" {
  description = "Nome do bucket S3 do cache de gazettes"
  value       = aws_s3_bucket.gazettes_cache.bucket
}

output "bucket_arn" {
  description = "ARN do bucket S3 do cache de gazettes"
  value       = aws_s3_bucket.gazettes_cache.arn
}

output "cloudfront_distribution_id" {
  description = "ID da distribuição CloudFront do cache de gazettes"
  value       = aws_cloudfront_distribution.gazettes_cache.id
}

output "cloudfront_domain" {
  description = "Domínio da distribuição CloudFront"
  value       = aws_cloudfront_distribution.gazettes_cache.domain_name
}

output "cdn_url" {
  description = "URL pública do CDN de gazettes"
  value       = "https://gazettes.fiscaldigital.org"
}
