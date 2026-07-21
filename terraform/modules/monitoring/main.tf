# ── CloudWatch Log Groups — retenção 30 dias ─────────────────────────────────
# 30 dias para RCA de incidentes detectados após uma semana.
# Custo: ~$0.03/GB/mês — insignificante no volume atual.

resource "aws_cloudwatch_log_group" "analyzer" {
  name              = "/aws/lambda/fiscal-digital-analyzer-prod"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "publisher" {
  name              = "/aws/lambda/fiscal-digital-publisher-prod"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/fiscal-digital-api-prod"
  retention_in_days = 30
}

# ── SNS — destino dos alarmes ─────────────────────────────────────────────────
# Diagnóstico 2026-07-20: os 4 alarmes existiam sem alarm_actions — disparavam
# para ninguém (a coleta ficou 50 dias sem publicar finding e ninguém soube).

resource "aws_sns_topic" "ops_alerts" {
  name = "fiscal-digital-ops-alerts-prod"
}

resource "aws_sns_topic_subscription" "ops_alerts_email" {
  topic_arn = aws_sns_topic.ops_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
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
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]
  ok_actions          = [aws_sns_topic.ops_alerts.arn]
  # Fila saudável não emite datapoint — sem isto o alarme vive em INSUFFICIENT_DATA
  treat_missing_data = "notBreaching"

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
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]
  ok_actions          = [aws_sns_topic.ops_alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = var.alerts_dlq_name
  }
}

# ── CloudWatch Alarm — coleta estagnada (freshness) ──────────────────────────
# 0 gazettes enfileiradas por 3 dias corridos = collector morto, EventBridge
# desabilitado ou QD totalmente fora — a janela de 3 dias absorve o fim de
# semana (cron MON-FRI). Sem datapoint = sem envio = breaching.

resource "aws_cloudwatch_metric_alarm" "gazettes_collect_stalled" {
  alarm_name          = "fiscal-digital-gazettes-collect-stalled-prod"
  comparison_operator = "LessThanOrEqualToThreshold"
  evaluation_periods  = 3
  metric_name         = "NumberOfMessagesSent"
  namespace           = "AWS/SQS"
  period              = 86400
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Nenhuma gazette enfileirada há 3 dias — coleta parada (collector/EventBridge/QD)"
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]
  ok_actions          = [aws_sns_topic.ops_alerts.arn]
  treat_missing_data  = "breaching"

  dimensions = {
    QueueName = var.gazettes_queue_name
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
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]
  ok_actions          = [aws_sns_topic.ops_alerts.arn]
  treat_missing_data  = "notBreaching"

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
  alarm_actions       = [aws_sns_topic.ops_alerts.arn]
  ok_actions          = [aws_sns_topic.ops_alerts.arn]
  treat_missing_data  = "notBreaching"

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
