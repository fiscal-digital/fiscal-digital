variable "hosted_zone_id" {
  description = "Route53 Hosted Zone ID para fiscaldigital.org"
  type        = string
}

variable "api_url" {
  description = "URL pública da API Lambda (sem trailing slash)"
  type        = string
}
