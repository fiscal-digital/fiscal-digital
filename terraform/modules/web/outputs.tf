output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "s3_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "s3_cache_bucket_name" {
  description = "Nome do bucket S3 usado para assets estáticos e cache ISR"
  value       = aws_s3_bucket.web.bucket
}

output "certificate_arn" {
  value = aws_acm_certificate_validation.web.certificate_arn
}

output "lambda_isr_function_name" {
  description = "Nome da Lambda ISR — CI usa em aws lambda update-function-code"
  value       = aws_lambda_function.web_isr.function_name
}

output "lambda_revalidate_function_name" {
  description = "Nome da Lambda revalidation worker — CI usa em aws lambda update-function-code"
  value       = aws_lambda_function.web_isr_revalidate.function_name
}

output "lambda_isr_function_url" {
  description = "Function URL da Lambda ISR (CloudFront roteia para cá como origin)"
  value       = aws_lambda_function_url.web_isr.function_url
}

output "sqs_revalidate_queue_url" {
  description = "URL da fila SQS de revalidação ISR"
  value       = aws_sqs_queue.web_isr_revalidate.url
}

output "dynamodb_isr_tags_table" {
  description = "Nome da tabela DynamoDB de tags ISR"
  value       = aws_dynamodb_table.web_isr_tags.name
}
