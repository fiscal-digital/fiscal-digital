# ── CloudWatch Log Groups — retenção 7 dias ──────────────────────────────────
# Sem retention_in_days, logs Lambda acumulam indefinidamente ($0.03/GB/mês).
# 7 dias cobre debug pós-incidente sem custo de armazenamento relevante.

resource "aws_cloudwatch_log_group" "collector" {
  name              = "/aws/lambda/fiscal-digital-collector-prod"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "analyzer" {
  name              = "/aws/lambda/fiscal-digital-analyzer-prod"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "publisher" {
  name              = "/aws/lambda/fiscal-digital-publisher-prod"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/fiscal-digital-api-prod"
  retention_in_days = 7
}

# ── CloudWatch Alarms — DLQ size ──────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "gazettes_dlq_nonempty" {
  alarm_name          = "fiscal-digital-gazettes-dlq-nonempty-prod"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "DLQ de gazettes tem mensagens — investigar falha no collector/analyzer"

  dimensions = {
    QueueName = var.gazettes_dlq_name
  }
}

resource "aws_cloudwatch_metric_alarm" "alerts_dlq_nonempty" {
  alarm_name          = "fiscal-digital-alerts-dlq-nonempty-prod"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "DLQ de alertas tem mensagens — investigar falha no publisher"

  dimensions = {
    QueueName = var.alerts_dlq_name
  }
}

# ── CloudWatch Alarms — Lambda errors ─────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "analyzer_errors" {
  alarm_name          = "fiscal-digital-analyzer-errors-prod"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Analyzer Lambda teve > 5 erros em 5 min"

  dimensions = {
    FunctionName = "fiscal-digital-analyzer-prod"
  }
}

resource "aws_cloudwatch_metric_alarm" "publisher_errors" {
  alarm_name          = "fiscal-digital-publisher-errors-prod"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Publisher Lambda teve > 5 erros em 5 min"

  dimensions = {
    FunctionName = "fiscal-digital-publisher-prod"
  }
}

# ── AWS Budget — $10 alerta / $20 bloqueio ────────────────────────────────────
# Nota: bloqueio real de gastos requer AWS Organizations + SCP.
# Esta config notifica por email em 50% ($10) e 100% ($20) do limite.

resource "aws_budgets_budget" "fiscal_digital" {
  name         = "fiscal-digital-monthly-prod"
  budget_type  = "COST"
  limit_amount = "20"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50 # 50% de $20 = $10
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100 # 100% = $20
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
