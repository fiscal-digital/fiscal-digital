output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "s3_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "certificate_arn" {
  value = aws_acm_certificate_validation.web.certificate_arn
}
