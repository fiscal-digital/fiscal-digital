data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"
  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'placeholder' })"
    filename = "index.js"
  }
}

locals {
  common_env = {
    AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    NODE_OPTIONS                        = "--enable-source-maps"
  }
}

resource "aws_lambda_function" "collector" {
  function_name    = "fiscal-digital-collector-prod"
  role             = var.collector_role_arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 300
  memory_size      = 512
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = merge(local.common_env, {
      GAZETTES_QUEUE_URL = var.gazettes_queue_url
    })
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "analyzer" {
  function_name    = "fiscal-digital-analyzer-prod"
  role             = var.analyzer_role_arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 300
  memory_size      = 512
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = merge(local.common_env, {
      ALERTS_QUEUE_URL = var.alerts_queue_url
    })
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "publisher" {
  function_name    = "fiscal-digital-publisher-prod"
  role             = var.publisher_role_arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 120
  memory_size      = 256
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = merge(local.common_env, {
      # Canais — habilitar via *_ENABLED. Default: dry-run desabilitado.
      # Smoke test inicial deve subir com *_DRY_RUN=true para validar sem postar.
      X_ENABLED      = var.x_enabled
      X_DRY_RUN      = var.x_dry_run
      REDDIT_ENABLED = var.reddit_enabled
      REDDIT_DRY_RUN = var.reddit_dry_run
    })
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "api" {
  function_name    = "fiscal-digital-api-prod"
  role             = var.api_role_arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 30
  memory_size      = 256
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = local.common_env
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# Analyzer triggered by gazettes queue
resource "aws_lambda_event_source_mapping" "analyzer" {
  event_source_arn = var.gazettes_queue_arn
  function_name    = aws_lambda_function.analyzer.arn
  batch_size       = 5
  enabled          = true
}

# Publisher triggered by alerts queue
resource "aws_lambda_event_source_mapping" "publisher" {
  event_source_arn = var.alerts_queue_arn
  function_name    = aws_lambda_function.publisher.arn
  batch_size       = 10
  enabled          = true
}
