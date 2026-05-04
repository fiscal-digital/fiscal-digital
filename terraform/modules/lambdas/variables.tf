variable "environment" {
  type = string
}

variable "collector_role_arn" {
  type = string
}

variable "analyzer_role_arn" {
  type = string
}

variable "publisher_role_arn" {
  type = string
}

variable "api_role_arn" {
  type = string
}

variable "costs_role_arn" {
  type = string
}

variable "costs_table_name" {
  type = string
}

variable "gazettes_queue_arn" {
  type = string
}

variable "alerts_queue_arn" {
  type = string
}

variable "gazettes_queue_url" {
  type = string
}

variable "alerts_queue_url" {
  type = string
}

# Canais de publicação — flags por canal. Default: desabilitados (smoke test antes de habilitar).
variable "x_enabled" {
  type    = string
  default = "false"
}

variable "x_dry_run" {
  type    = string
  default = "true"
}

variable "reddit_enabled" {
  type    = string
  default = "false"
}

variable "reddit_dry_run" {
  type    = string
  default = "true"
}

# ISR-WEB-002 — token simétrico /api/revalidate. Vem de module.web.revalidate_secret_value.
variable "web_revalidate_secret" {
  type        = string
  sensitive   = true
  description = "Token Bearer pro publisher autenticar POST /api/revalidate na Lambda ISR."
}
