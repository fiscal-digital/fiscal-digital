output "collector_lambda_arn" {
  value = module.lambdas.collector_arn
}

output "analyzer_lambda_arn" {
  value = module.lambdas.analyzer_arn
}

output "publisher_lambda_arn" {
  value = module.lambdas.publisher_arn
}

output "api_lambda_arn" {
  value = module.lambdas.api_arn
}

output "api_url" {
  value = module.lambdas.api_url
}

output "gazettes_queue_url" {
  value = module.sqs.gazettes_queue_url
}

output "alerts_queue_url" {
  value = module.sqs.alerts_queue_url
}

output "github_actions_role_arn" {
  value = module.iam.github_actions_role_arn
}

output "kms_key_arn" {
  value = module.kms.key_arn
}
