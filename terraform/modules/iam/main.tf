data "aws_caller_identity" "current" {}

# Lookup do secret por nome — evita expor account ID em prod.tfvars
data "aws_secretsmanager_secret" "anthropic" {
  name = "fiscaldigital-anthropic-prod"
}

# ─── GitHub Actions OIDC ─────────────────────────────────────────────────────

# OIDC provider já existe na conta (compartilhado entre projetos da org)
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_org}/${var.github_repo}:*",
        "repo:${var.github_org}/fiscal-digital-web:*",
        "repo:${var.github_org}/fiscal-digital-collectors:*",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "fiscal-digital-github-actions-prod"
  assume_role_policy = data.aws_iam_policy_document.github_trust.json
}

resource "aws_iam_role_policy" "github_actions" {
  role = aws_iam_role.github_actions.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TerraformState"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"]
        Resource = [
          "arn:aws:s3:::fiscal-digital-terraform-state",
          "arn:aws:s3:::fiscal-digital-terraform-state/*",
        ]
      },
      {
        Sid      = "TerraformLock"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/fiscal-digital-terraform-lock"
      },
      {
        Sid      = "LambdaDeploy"
        Effect   = "Allow"
        Action   = ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:PublishVersion", "lambda:UpdateAlias"]
        Resource = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:fiscal-digital-*"
      },
      {
        Sid    = "TerraformManage"
        Effect = "Allow"
        Action = [
          "lambda:*", "dynamodb:*", "sqs:*", "events:*", "kms:*",
          "iam:GetRole", "iam:CreateRole", "iam:UpdateRole", "iam:DeleteRole",
          "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy",
          "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
          "iam:TagRole", "iam:PassRole",
          "iam:GetOpenIDConnectProvider",
          "iam:CreatePolicy", "iam:GetPolicy", "iam:DeletePolicy",
          "iam:GetPolicyVersion", "iam:ListPolicyVersions",
        ]
        Resource = [
          "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:fiscal-digital-*",
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/fiscal-digital-*",
          "arn:aws:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:fiscal-digital-*",
          "arn:aws:events:${var.aws_region}:${data.aws_caller_identity.current.account_id}:rule/fiscal-digital-*",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/fiscal-digital-*",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/fiscal-digital-*",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com",
          "arn:aws:kms:${var.aws_region}:${data.aws_caller_identity.current.account_id}:key/*",
          "arn:aws:kms:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alias/fiscal-digital-*",
        ]
      },
      {
        # GetResourcePolicy necessário para o data source do Terraform ler a secret
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:GetResourcePolicy",
        ]
        Effect   = "Allow"
        Resource = data.aws_secretsmanager_secret.anthropic.arn
        Sid      = "SecretsManagerRead"
      },
      {
        # Resource = "*" obrigatório — iam:List* não suporta resource-level (ver IAM Action Reference)
        Action   = ["iam:ListOpenIDConnectProviders"]
        Effect   = "Allow"
        Resource = "*"
        Sid      = "IAMReadAccount"
      },
      {
        # Resource = "*" obrigatório — kms:List* não suporta resource-level
        Action   = ["kms:ListAliases", "kms:ListKeys"]
        Effect   = "Allow"
        Resource = "*"
        Sid      = "KMSReadAccount"
      },
      {
        Action = [
          "lambda:CreateEventSourceMapping",
          "lambda:DeleteEventSourceMapping",
          "lambda:GetEventSourceMapping",
          "lambda:ListEventSourceMappings",
          "lambda:ListTags",
          "lambda:UpdateEventSourceMapping",
        ]
        Effect   = "Allow"
        Resource = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:event-source-mapping:*"
        Sid      = "LambdaEventSourceMappings"
      },
      {
        # DescribeLogGroups e uma operacao de listagem — Resource = "*" obrigatorio
        Sid      = "CloudWatchLogsDescribe"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = "*"
      },
      {
        # CloudWatch Logs — gerenciar log groups das Lambdas (retention policy, etc.)
        Sid    = "CloudWatchLogsManage"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:PutRetentionPolicy",
          "logs:ListTagsLogGroup",
          "logs:ListTagsForResource",
          "logs:TagResource",
          "logs:UntagResource",
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/fiscal-digital-*"
      },
      {
        # CloudWatch alarms para monitoring module (S-04)
        Sid    = "CloudWatchAlarms"
        Effect = "Allow"
        Action = [
          "cloudwatch:DescribeAlarms",
          "cloudwatch:PutMetricAlarm",
          "cloudwatch:DeleteAlarms",
          "cloudwatch:ListTagsForResource",
          "cloudwatch:TagResource",
          "cloudwatch:UntagResource",
        ]
        Resource = "arn:aws:cloudwatch:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alarm:fiscal-digital-*"
      },
      {
        # AWS Budgets — Resource = "*" obrigatório (budgets não suporta resource-level em todas as ações)
        Sid      = "BudgetsManage"
        Effect   = "Allow"
        Action   = ["budgets:CreateBudget", "budgets:ModifyBudget", "budgets:ViewBudget", "budgets:DeleteBudget", "budgets:DescribeBudgets", "budgets:ListTagsForResource"]
        Resource = "*"
      },
      {
        # Deploy do site estático fiscal-digital-web para S3
        Sid    = "WebS3Deploy"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [
          "arn:aws:s3:::fiscal-digital-web-prod",
          "arn:aws:s3:::fiscal-digital-web-prod/*",
        ]
      },
      {
        # Cache de gazettes — CI precisa de GetObject/PutObject para smoke tests e validação
        Sid    = "GazettesCacheS3Deploy"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [
          "arn:aws:s3:::fiscal-digital-gazettes-cache-prod",
          "arn:aws:s3:::fiscal-digital-gazettes-cache-prod/*",
        ]
      },
      {
        # Cache de gazettes — Terraform precisa gerenciar tags, policies, lifecycle,
        # encryption, versioning, CORS etc. do bucket (recursos do módulo gazettes-cache).
        Sid    = "GazettesCacheS3Manage"
        Effect = "Allow"
        Action = [
          "s3:PutBucketTagging", "s3:GetBucketTagging", "s3:DeleteBucketTagging",
          "s3:PutBucketPolicy", "s3:DeleteBucketPolicy",
          "s3:PutBucketVersioning", "s3:GetBucketVersioning",
          "s3:PutEncryptionConfiguration", "s3:GetEncryptionConfiguration",
          "s3:PutLifecycleConfiguration", "s3:GetLifecycleConfiguration",
          "s3:PutBucketPublicAccessBlock", "s3:GetBucketPublicAccessBlock",
          "s3:PutBucketOwnershipControls", "s3:GetBucketOwnershipControls",
          "s3:PutBucketCORS", "s3:GetBucketCORS",
          "s3:PutBucketLogging", "s3:GetBucketLogging",
          "s3:PutBucketNotification", "s3:GetBucketNotification",
          "s3:PutBucketAcl", "s3:GetBucketAcl",
        ]
        Resource = "arn:aws:s3:::fiscal-digital-gazettes-cache-prod"
      },
      {
        # Invalidação do CloudFront após deploy
        Sid      = "WebCloudFrontInvalidate"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetDistribution", "cloudfront:ListDistributions"]
        Resource = "*"
      },
      {
        # ACM — criar/validar certificado SSL para fiscaldigital.org
        Sid      = "ACMManage"
        Effect   = "Allow"
        Action   = ["acm:RequestCertificate", "acm:DescribeCertificate", "acm:DeleteCertificate", "acm:ListCertificates", "acm:AddTagsToCertificate", "acm:ListTagsForCertificate"]
        Resource = "*"
      },
      {
        # Route53 — criar registros A/AAAA e validação ACM
        Sid      = "Route53Manage"
        Effect   = "Allow"
        Action   = ["route53:GetHostedZone", "route53:ListHostedZones", "route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets", "route53:GetChange"]
        Resource = "*"
      },
      {
        # S3 bucket management para módulo web
        Sid    = "WebS3BucketManage"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket", "s3:DeleteBucket",
          "s3:GetBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy",
          "s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock",
          "s3:GetBucketVersioning", "s3:GetBucketAcl",
          "s3:GetBucketCORS", "s3:GetBucketWebsite",
          "s3:GetBucketLogging", "s3:GetBucketRequestPayment",
          "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration",
          "s3:GetReplicationConfiguration", "s3:GetBucketTagging",
          "s3:GetBucketObjectLockConfiguration", "s3:ListAllMyBuckets",
          "s3:GetAccelerateConfiguration",
        ]
        Resource = "*"
      },
      {
        # CloudFront OAC management
        Sid    = "WebCloudFrontManage"
        Effect = "Allow"
        Action = [
          "cloudfront:GetOriginAccessControl",
          "cloudfront:CreateOriginAccessControl",
          "cloudfront:UpdateOriginAccessControl",
          "cloudfront:DeleteOriginAccessControl",
          "cloudfront:ListOriginAccessControls",
          "cloudfront:GetDistribution",
          "cloudfront:CreateDistribution",
          "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution",
          "cloudfront:TagResource",
          "cloudfront:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        # CloudFront Response Headers Policy — necessário para gazettes-cache
        # (Content-Disposition: inline + X-Frame-Options + CORS)
        Sid    = "CloudFrontResponseHeadersPolicy"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateResponseHeadersPolicy",
          "cloudfront:UpdateResponseHeadersPolicy",
          "cloudfront:DeleteResponseHeadersPolicy",
          "cloudfront:GetResponseHeadersPolicy",
          "cloudfront:ListResponseHeadersPolicies",
        ]
        Resource = "*"
      },
      {
        # iam:UpdateAssumeRolePolicy — necessário para o próprio Terraform
        # atualizar a trust policy de roles fiscal-digital-* (ex: adicionar
        # mais um repo no sub do OIDC).
        Sid      = "IAMUpdateAssumeRolePolicySelf"
        Effect   = "Allow"
        Action   = ["iam:UpdateAssumeRolePolicy"]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/fiscal-digital-*"
      },
    ]
  })
}

# ─── Shared trust + log policy ───────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_policy" "lambda_logs" {
  name = "fiscal-digital-lambda-logs-prod"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/fiscal-digital-*:*"
    }]
  })
}

# ─── Collector ───────────────────────────────────────────────────────────────

resource "aws_iam_role" "collector" {
  name               = "fiscal-digital-collector-prod"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "collector_logs" {
  role       = aws_iam_role.collector.name
  policy_arn = aws_iam_policy.lambda_logs.arn
}

resource "aws_iam_role_policy" "collector" {
  role = aws_iam_role.collector.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = var.gazettes_table_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = var.gazettes_queue_arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = var.kms_key_arn
      },
      {
        # Cache de PDFs do Querido Diário — PutObject + HeadObject para idempotência
        Sid    = "GazettesPdfCache"
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:HeadObject", "s3:GetObject"]
        Resource = [
          "arn:aws:s3:::fiscal-digital-gazettes-cache-prod",
          "arn:aws:s3:::fiscal-digital-gazettes-cache-prod/*",
        ]
      },
    ]
  })
}

# ─── Analyzer ────────────────────────────────────────────────────────────────

resource "aws_iam_role" "analyzer" {
  name               = "fiscal-digital-analyzer-prod"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "analyzer_logs" {
  role       = aws_iam_role.analyzer.name
  policy_arn = aws_iam_policy.lambda_logs.arn
}

resource "aws_iam_role_policy" "analyzer" {
  role = aws_iam_role.analyzer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
        Resource = [
          var.alerts_table_arn,
          "${var.alerts_table_arn}/index/*",
          var.gazettes_table_arn,
          var.suppliers_table_arn,
          var.entities_table_arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = var.gazettes_queue_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = var.alerts_queue_arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = data.aws_secretsmanager_secret.anthropic.arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = var.kms_key_arn
      },
      {
        # Resource = "*" — foundation-model e inference-profile ARNs não têm account ID
        Sid      = "BedrockInvoke"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "*"
      },
    ]
  })
}

# ─── Publisher ───────────────────────────────────────────────────────────────

resource "aws_iam_role" "publisher" {
  name               = "fiscal-digital-publisher-prod"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "publisher_logs" {
  role       = aws_iam_role.publisher.name
  policy_arn = aws_iam_policy.lambda_logs.arn
}

resource "aws_iam_role_policy" "publisher" {
  role = aws_iam_role.publisher.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = var.alerts_table_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = var.alerts_queue_arn
      },
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:fiscaldigital-x-prod*",
          "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:fiscaldigital-reddit-prod*",
        ]
      },
      {
        # GenerateDataKey necessário para UpdateItem em tabela com SSE-KMS
        # (publications-store grava resultado de cada canal no item do Finding)
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = var.kms_key_arn
      },
    ]
  })
}

# ─── API ─────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "api" {
  name               = "fiscal-digital-api-prod"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = aws_iam_policy.lambda_logs.arn
}

resource "aws_iam_role_policy" "api" {
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"]
        Resource = [
          var.alerts_table_arn,
          "${var.alerts_table_arn}/index/*",
          var.suppliers_table_arn,
        ]
      },
      {
        # Scan COUNT em gazettes-prod para /stats (totalGazettesProcessed).
        # GetItem/Query também necessários para expor cachedPdfUrl na Fase 2.
        Effect = "Allow"
        Action = ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:Query"]
        Resource = [
          var.gazettes_table_arn,
          "${var.gazettes_table_arn}/index/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = var.kms_key_arn
      },
      {
        # Leitura do cache de PDFs para servir URL pré-assinada ou redirect
        Sid      = "GazettesCacheRead"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:HeadObject"]
        Resource = "arn:aws:s3:::fiscal-digital-gazettes-cache-prod/*"
      },
      {
        # Newsletter: PutItem para inscrição, UpdateItem para confirm/unsubscribe.
        # GetItem para checar duplicação antes de inserir.
        Sid      = "NewsletterReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = var.newsletter_table_arn
      },
    ]
  })
}
