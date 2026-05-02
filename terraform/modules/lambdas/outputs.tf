output "collector_arn" {
  value = aws_lambda_function.collector.arn
}

output "analyzer_arn" {
  value = aws_lambda_function.analyzer.arn
}

output "publisher_arn" {
  value = aws_lambda_function.publisher.arn
}

output "api_arn" {
  value = aws_lambda_function.api.arn
}

output "api_url" {
  value = aws_lambda_function_url.api.function_url
}
