resource "aws_cloudwatch_event_rule" "daily_collector" {
  name = "fiscal-digital-daily-collector-prod"
  # Throttle 2026-05-05: Querido Diário tem indexação irregular por spider —
  # várias cidades nossas (Caxias, POA, SP, Brasília) sem gazette nova há
  # meses. Reduzido de Mon-Fri para Mon-only enquanto OKFN não retoma fluxo
  # nessas cidades. Histórico do gap em issue #1451 do okfn-brasil/querido-diario.
  # Voltar para MON-FRI quando OKFN sinalizar normalização.
  description         = "Aciona o collector às segundas 07:00 UTC (04:00 BRT). Throttle por gap de indexação no QD."
  schedule_expression = "cron(0 7 ? * MON *)"
}

resource "aws_cloudwatch_event_target" "collector" {
  rule = aws_cloudwatch_event_rule.daily_collector.name
  arn  = var.collector_lambda_arn
}

resource "aws_lambda_permission" "eventbridge_collector" {
  statement_id  = "AllowEventBridgeInvokeCollector"
  action        = "lambda:InvokeFunction"
  function_name = var.collector_lambda_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_collector.arn
}

# FiscalCustos — daily às 06:00 UTC (03:00 BRT). Cost Explorer só finaliza dado
# do dia anterior ~24h depois, então o agente sempre coleta janela móvel de 7 dias.
resource "aws_cloudwatch_event_rule" "daily_costs" {
  name                = "fiscal-digital-daily-costs-prod"
  description         = "Aciona o FiscalCustos diariamente às 06:00 UTC (03:00 BRT)"
  schedule_expression = "cron(0 6 * * ? *)"
}

resource "aws_cloudwatch_event_target" "costs" {
  rule = aws_cloudwatch_event_rule.daily_costs.name
  arn  = var.costs_lambda_arn
}

resource "aws_lambda_permission" "eventbridge_costs" {
  statement_id  = "AllowEventBridgeInvokeCosts"
  action        = "lambda:InvokeFunction"
  function_name = var.costs_lambda_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_costs.arn
}
