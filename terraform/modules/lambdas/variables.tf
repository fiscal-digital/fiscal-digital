variable "analyzer_role_arn" {
  type = string
}

# fiscal-digital#239 — chave CGU para checkSanctions no analyzer
variable "cgu_param_name" {
  type        = string
  description = "Parametro SSM (SecureString) com a chave da CGU."
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

# ISR-WEB-002 — token simétrico /api/revalidate. Só o nome do parametro chega à Lambda (#240).
variable "web_revalidate_param_name" {
  type        = string
  description = "Parametro SSM (SecureString) com o token Bearer de POST /api/revalidate na Lambda ISR."
}
