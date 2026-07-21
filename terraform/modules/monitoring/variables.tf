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

variable "gazettes_queue_name" {
  description = "Name of the gazettes ingestion queue (freshness alarm)"
  type        = string
}

variable "kms_key_arn" {
  description = "CMK for SNS topic encryption (CKV_AWS_26)"
  type        = string
}
