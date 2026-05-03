variable "hosted_zone_id" {
  description = "Route53 Hosted Zone ID para fiscaldigital.org"
  type        = string
}

variable "api_url" {
  description = "URL pública da API Lambda (sem trailing slash)"
  type        = string
}

variable "lambda_isr_zip_path" {
  description = "Caminho local para o zip do servidor ISR gerado pelo open-next build. Deixar vazio para usar placeholder (CI substitui via update-function-code)."
  type        = string
  default     = ""
}

variable "lambda_revalidate_zip_path" {
  description = "Caminho local para o zip do revalidation worker gerado pelo open-next build. Deixar vazio para usar placeholder (CI substitui via update-function-code)."
  type        = string
  default     = ""
}
