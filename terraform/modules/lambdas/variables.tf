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
