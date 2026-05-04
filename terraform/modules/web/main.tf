data "aws_caller_identity" "current" {}

# ─── KMS key (data lookup — alias criado pelo módulo kms) ───────────────────

data "aws_kms_key" "main" {
  key_id = "alias/fiscal-digital-kms-prod"
}

# ─── ACM Certificate (must be us-east-1 for CloudFront) ─────────────────────

resource "aws_acm_certificate" "web" {
  domain_name               = "fiscaldigital.org"
  subject_alternative_names = ["www.fiscaldigital.org"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.web.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.hosted_zone_id
}

resource "aws_acm_certificate_validation" "web" {
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]

  timeouts {
    create = "10m"
  }
}

# ─── S3 bucket (assets estáticos + ISR cache) ────────────────────────────────

resource "aws_s3_bucket" "web" {
  bucket = "fiscal-digital-web-prod"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── CloudFront OAC ──────────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "fiscal-digital-web-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ─── IAM Role — Lambda ISR ───────────────────────────────────────────────────

data "aws_iam_policy_document" "web_isr_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "web_isr" {
  name               = "fiscal-digital-web-isr-prod-role"
  assume_role_policy = data.aws_iam_policy_document.web_isr_assume.json
}

data "aws_iam_policy_document" "web_isr_policy" {
  # CloudWatch Logs
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/fiscal-digital-web-isr*"]
  }

  # S3 — bucket de assets/cache (read + write para ISR)
  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.web.arn,
      "${aws_s3_bucket.web.arn}/*",
    ]
  }

  # SQS — enfileirar revalidações
  statement {
    actions = [
      "sqs:SendMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.web_isr_revalidate.arn]
  }

  # DynamoDB — tag table ISR
  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = [
      aws_dynamodb_table.web_isr_tags.arn,
      "${aws_dynamodb_table.web_isr_tags.arn}/index/*",
    ]
  }

  # KMS — decrypt/encrypt para S3 SSE
  statement {
    actions = [
      "kms:GenerateDataKey",
      "kms:Decrypt",
    ]
    resources = [data.aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "web_isr" {
  name   = "fiscal-digital-web-isr-prod-policy"
  role   = aws_iam_role.web_isr.id
  policy = data.aws_iam_policy_document.web_isr_policy.json
}

# IAM role para revalidation worker (consome SQS + acessa DDB + S3)
resource "aws_iam_role" "web_isr_revalidate" {
  name               = "fiscal-digital-web-isr-revalidate-prod-role"
  assume_role_policy = data.aws_iam_policy_document.web_isr_assume.json
}

data "aws_iam_policy_document" "web_isr_revalidate_policy" {
  # CloudWatch Logs
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/fiscal-digital-web-isr*"]
  }

  # SQS — consumir fila de revalidação
  statement {
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.web_isr_revalidate.arn]
  }

  # S3 — escrever cache invalidado
  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.web.arn,
      "${aws_s3_bucket.web.arn}/*",
    ]
  }

  # DynamoDB — tag table ISR
  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = [
      aws_dynamodb_table.web_isr_tags.arn,
      "${aws_dynamodb_table.web_isr_tags.arn}/index/*",
    ]
  }

  # KMS
  statement {
    actions = [
      "kms:GenerateDataKey",
      "kms:Decrypt",
    ]
    resources = [data.aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "web_isr_revalidate" {
  name   = "fiscal-digital-web-isr-revalidate-prod-policy"
  role   = aws_iam_role.web_isr_revalidate.id
  policy = data.aws_iam_policy_document.web_isr_revalidate_policy.json
}

# ─── SQS — Revalidation queue + DLQ ─────────────────────────────────────────

resource "aws_sqs_queue" "web_isr_revalidate_dlq" {
  name                       = "fiscal-digital-web-isr-revalidate-dlq-prod"
  visibility_timeout_seconds = 60
  kms_master_key_id          = data.aws_kms_key.main.arn
}

resource "aws_sqs_queue" "web_isr_revalidate" {
  name                       = "fiscal-digital-web-isr-revalidate-prod"
  visibility_timeout_seconds = 35 # >= Lambda timeout (30s) + 5s buffer

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.web_isr_revalidate_dlq.arn
    maxReceiveCount     = 3
  })

  kms_master_key_id = data.aws_kms_key.main.arn
}

# ─── DynamoDB — ISR tag table ────────────────────────────────────────────────

resource "aws_dynamodb_table" "web_isr_tags" {
  name         = "fiscal-digital-web-isr-tags-prod"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tag"
  range_key    = "path"

  attribute {
    name = "tag"
    type = "S"
  }

  attribute {
    name = "path"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_key.main.arn
  }
}

# ─── Lambda placeholder zip (substituído pelo CI via update-function-code) ───

data "archive_file" "web_isr_placeholder" {
  type        = "zip"
  output_path = "${path.module}/web-isr-placeholder.zip"
  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'placeholder - deploy pending' })"
    filename = "index.js"
  }
}

# ─── Lambda ISR — servidor Next.js ───────────────────────────────────────────

resource "aws_lambda_function" "web_isr" {
  function_name    = "fiscal-digital-web-isr-prod"
  role             = aws_iam_role.web_isr.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 30
  memory_size      = 1024
  filename         = var.lambda_isr_zip_path != "" ? var.lambda_isr_zip_path : data.archive_file.web_isr_placeholder.output_path
  source_code_hash = var.lambda_isr_zip_path != "" ? filebase64sha256(var.lambda_isr_zip_path) : data.archive_file.web_isr_placeholder.output_base64sha256

  environment {
    variables = {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
      NODE_OPTIONS                        = "--enable-source-maps"
      NEXT_API_URL                        = var.api_url
      CACHE_BUCKET_NAME                   = aws_s3_bucket.web.bucket
      REVALIDATION_QUEUE_URL              = aws_sqs_queue.web_isr_revalidate.url
      ISR_TAG_TABLE_NAME                  = aws_dynamodb_table.web_isr_tags.name
      # ISR-WEB-002: token simétrico para /api/revalidate. Publisher usa o
      # mesmo secret pra autenticar revalidações on-demand pós-ingestão.
      WEB_REVALIDATE_SECRET = aws_secretsmanager_secret_version.web_revalidate.secret_string
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── Secrets Manager — token /api/revalidate (ISR-WEB-002) ──────────────────

resource "aws_secretsmanager_secret" "web_revalidate" {
  name                    = "fiscal-digital-revalidate-token-prod"
  description             = "Token simétrico para POST /api/revalidate da Lambda ISR. Publisher usa o mesmo valor pra autenticar revalidação on-demand."
  recovery_window_in_days = 7
  kms_key_id              = data.aws_kms_key.main.arn
}

resource "random_password" "web_revalidate_token" {
  length  = 48
  special = false # base64-safe pra header Authorization
}

resource "aws_secretsmanager_secret_version" "web_revalidate" {
  secret_id     = aws_secretsmanager_secret.web_revalidate.id
  secret_string = random_password.web_revalidate_token.result
}

resource "aws_lambda_function_url" "web_isr" {
  function_name      = aws_lambda_function.web_isr.function_name
  authorization_type = "NONE"
  invoke_mode        = "BUFFERED"

  cors {
    allow_credentials = false
    allow_origins     = ["*"]
    # AWS API rejeita "OPTIONS" (7 chars > 6 chars constraint). Usar "*" cobre
    # tudo (GET, HEAD, OPTIONS, POST, etc.) sem hit nessa constraint mal
    # documentada do CreateFunctionUrlConfig.
    allow_methods = ["*"]
    allow_headers = ["*"]
    max_age       = 3600
  }
}

# ─── Lambda revalidation worker ──────────────────────────────────────────────

resource "aws_lambda_function" "web_isr_revalidate" {
  function_name    = "fiscal-digital-web-isr-revalidate-prod"
  role             = aws_iam_role.web_isr_revalidate.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 30
  memory_size      = 256
  filename         = var.lambda_revalidate_zip_path != "" ? var.lambda_revalidate_zip_path : data.archive_file.web_isr_placeholder.output_path
  source_code_hash = var.lambda_revalidate_zip_path != "" ? filebase64sha256(var.lambda_revalidate_zip_path) : data.archive_file.web_isr_placeholder.output_base64sha256

  environment {
    variables = {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
      NODE_OPTIONS                        = "--enable-source-maps"
      CACHE_BUCKET_NAME                   = aws_s3_bucket.web.bucket
      ISR_TAG_TABLE_NAME                  = aws_dynamodb_table.web_isr_tags.name
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_event_source_mapping" "web_isr_revalidate_sqs" {
  event_source_arn = aws_sqs_queue.web_isr_revalidate.arn
  function_name    = aws_lambda_function.web_isr_revalidate.arn
  batch_size       = 5
}

# ─── CloudFront Function — redirect /pt → /pt-br ────────────────────────────

# Passo (2) foi removido: Lambda ISR resolve subdir/trailing-slash internamente.
resource "aws_cloudfront_function" "redirect_pt_to_pt_br" {
  name    = "fiscal-digital-redirect-pt-to-pt-br"
  runtime = "cloudfront-js-2.0"
  comment = "301 /pt/* → /pt-br/* (BCP 47 explicit) — step 2 removed: Lambda ISR resolves subdirs"
  publish = true
  code    = file("${path.module}/redirect-pt-to-pt-br.js")
}

# ─── CloudFront distribution ─────────────────────────────────────────────────

locals {
  # Extrai apenas o hostname da Function URL (sem https:// e sem trailing slash)
  lambda_isr_domain = replace(replace(aws_lambda_function_url.web_isr.function_url, "https://", ""), "/", "")
}

resource "aws_cloudfront_distribution" "web" {
  enabled         = true
  is_ipv6_enabled = true
  # Sem default_root_object — Lambda ISR serve "/" diretamente
  aliases     = ["fiscaldigital.org", "www.fiscaldigital.org"]
  price_class = "PriceClass_100"
  comment     = "fiscal-digital-web-prod"

  # Origin 1 — S3 assets estáticos
  # Workflow CI sincroniza .open-next/assets/ para bucket root (mirror direto):
  # /_next/static/...  /brand/...  /favicon.ico  etc — paths que o Next gera no HTML.
  # Sem origin_path: behaviors mapeiam 1:1 do request URI pra S3 key.
  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3-assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  # Origin 2 — Lambda ISR (custom origin via Function URL)
  origin {
    domain_name = local.lambda_isr_domain
    origin_id   = "lambda-isr"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Behavior padrão — Lambda ISR (respeita Cache-Control da Lambda)
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "lambda-isr"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.redirect_pt_to_pt_br.arn
    }

    forwarded_values {
      query_string = true
      # NÃO forward "Host" para Lambda Function URL — Function URL valida que
      # o Host header bate com seu próprio domain (lambda-url.us-east-1.on.aws);
      # forward do Host original (fiscaldigital.org) gera 403 AccessDeniedException.
      # Accept-Encoding mantido para compressão funcionar.
      headers = ["Accept-Encoding"]
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0 # Lambda ISR controla via Cache-Control
    max_ttl     = 86400
  }

  # Behavior /_next/static/* — S3, TTL 1 ano (immutable hashed assets)
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-assets"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 31536000
    default_ttl = 31536000
    max_ttl     = 31536000
  }

  # Behavior /_next/data/* — Lambda ISR (JSON data routes do Next.js)
  ordered_cache_behavior {
    path_pattern           = "/_next/data/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "lambda-isr"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = true
      # NÃO forward Host (causa 403 no Lambda Function URL — ver default behavior)
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 86400
  }

  # Behavior /_next/image* — Lambda ISR (unoptimized:true, mas roteia certo)
  ordered_cache_behavior {
    path_pattern           = "/_next/image*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "lambda-isr"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = true
      # NÃO forward Host (causa 403 no Lambda Function URL — ver default behavior)
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # 404 real da Lambda ISR → sem custom_error_response (Lambda gera a página)
  # Mantido apenas 403 do S3 (acesso negado a objeto não-existente no behavior s3-assets)
  custom_error_response {
    error_code         = 403
    response_code      = 404
    response_page_path = "/404"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.web.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ─── S3 bucket policy (CloudFront OAC access) ────────────────────────────────

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.web.arn
        }
      }
    }]
  })
}

# ─── Route53 records ─────────────────────────────────────────────────────────

resource "aws_route53_record" "web_a" {
  zone_id = var.hosted_zone_id
  name    = "fiscaldigital.org"
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "web_aaaa" {
  zone_id = var.hosted_zone_id
  name    = "fiscaldigital.org"
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_a" {
  zone_id = var.hosted_zone_id
  name    = "www.fiscaldigital.org"
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}
