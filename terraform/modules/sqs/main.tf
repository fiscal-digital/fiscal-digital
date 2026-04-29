resource "aws_sqs_queue" "gazettes_dlq" {
  name              = "fiscal-digital-gazettes-dlq-prod"
  kms_master_key_id = var.kms_key_arn
}

resource "aws_sqs_queue" "gazettes" {
  name                       = "fiscal-digital-gazettes-queue-prod"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 86400
  kms_master_key_id          = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.gazettes_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue" "alerts_dlq" {
  name              = "fiscal-digital-dlq-prod"
  kms_master_key_id = var.kms_key_arn
}

resource "aws_sqs_queue" "alerts" {
  name                       = "fiscal-digital-queue-prod"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400
  kms_master_key_id          = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.alerts_dlq.arn
    maxReceiveCount     = 3
  })
}
