output "api_url" {
  value       = "https://api.fiscaldigital.org"
  description = "URL pública canônica da API (use no OpenAPI servers, lib/api.ts do site, etc.)"
}

output "cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.api.id
  description = "Distribution ID — usar para invalidations pós-deploy se necessário"
}

output "cloudfront_domain_name" {
  value       = aws_cloudfront_distribution.api.domain_name
  description = "Domain interno do CloudFront (alvo dos Route53 alias)"
}
