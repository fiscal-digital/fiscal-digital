variable "hosted_zone_id" {
  type        = string
  description = "Route53 Hosted Zone ID para fiscaldigital.org"
}

variable "lambda_function_url_domain" {
  type        = string
  description = "Domain do Lambda Function URL da API (sem https:// e sem trailing slash)"
  # Exemplo: "7vvbdbxwfz4h57j7dfk65wpux40gqayb.lambda-url.us-east-1.on.aws"
}
