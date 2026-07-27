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

output "github_actions_web_role_arn" {
  value       = aws_iam_role.github_actions_web.arn
  description = "ARN da role IAM dedicada ao repo fiscal-digital-web via OIDC"
}

output "sentinel_ro_role_arn" {
  description = "Role OIDC read-only da sentinela de frescor (GH Actions, repo collectors)"
  value       = aws_iam_role.sentinel_ro.arn
}

output "audit_ro_role_arn" {
  description = "Role OIDC read-only da auditoria mensal (GH Actions, repo engine)"
  value       = aws_iam_role.audit_ro.arn
}
