variable "gazettes_dlq_name" {
  description = "Name of the gazettes Dead Letter Queue"
  type        = string
}

variable "alerts_dlq_name" {
  description = "Name of the alerts Dead Letter Queue"
  type        = string
}

variable "alert_email" {
  description = "Email address to receive budget and alarm notifications"
  type        = string
  default     = "diegovieira.ti@gmail.com"
}
