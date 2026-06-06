output "analyzer_role_arn" {
  value = aws_iam_role.analyzer.arn
}

output "publisher_role_arn" {
  value = aws_iam_role.publisher.arn
}

output "api_role_arn" {
  value = aws_iam_role.api.arn
}

output "github_actions_role_arn" {
  value = aws_iam_role.github_actions.arn
}

output "costs_role_arn" {
  value = aws_iam_role.costs.arn
}

output "github_actions_collectors_role_arn" {
  value       = aws_iam_role.github_actions_collectors.arn
  description = "ARN da role IAM dedicada ao repo fiscal-digital-collectors via OIDC"
}
