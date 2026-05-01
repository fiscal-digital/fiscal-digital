variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"
}

variable "github_org" {
  description = "GitHub organization or username for OIDC trust"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "fiscal-digital"
}

variable "alert_email" {
  description = "Email address for budget and CloudWatch alarm notifications"
  type        = string
  default     = "diegovieira.ti@gmail.com"
}

# ── Canais de publicação — passados para o módulo lambdas ─────────────────────

variable "x_enabled" {
  description = "Habilitar publicação no X (Twitter)"
  type        = string
  default     = "false"
}

variable "x_dry_run" {
  description = "Modo dry-run para o canal X (não posta de verdade)"
  type        = string
  default     = "true"
}

variable "reddit_enabled" {
  description = "Habilitar publicação no Reddit"
  type        = string
  default     = "false"
}

variable "reddit_dry_run" {
  description = "Modo dry-run para o Reddit (não posta de verdade)"
  type        = string
  default     = "true"
}

