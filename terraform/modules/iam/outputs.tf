output "collector_role_arn" {
  value = aws_iam_role.collector.arn
}

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
