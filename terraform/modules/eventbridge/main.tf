resource "aws_cloudwatch_event_rule" "daily_collector" {
  name                = "fiscal-digital-daily-collector-prod"
  description         = "Aciona o collector diariamente à meia-noite BRT (03:00 UTC)"
  schedule_expression = "cron(0 3 * * ? *)"
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
