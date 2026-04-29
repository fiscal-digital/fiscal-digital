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

