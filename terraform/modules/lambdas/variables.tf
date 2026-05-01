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
