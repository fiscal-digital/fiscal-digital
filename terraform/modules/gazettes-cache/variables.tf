variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 Hosted Zone ID para fiscaldigital.org"
  type        = string
}
