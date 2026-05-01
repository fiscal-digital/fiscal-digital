output "gazettes_queue_arn" {
  value = aws_sqs_queue.gazettes.arn
}

output "gazettes_queue_url" {
  value = aws_sqs_queue.gazettes.url
}

output "alerts_queue_arn" {
  value = aws_sqs_queue.alerts.arn
}

output "alerts_queue_url" {
  value = aws_sqs_queue.alerts.url
}

output "gazettes_dlq_name" {
  value = aws_sqs_queue.gazettes_dlq.name
}

output "alerts_dlq_name" {
  value = aws_sqs_queue.alerts_dlq.name
}
