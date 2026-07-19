module "kms" {
  source      = "./modules/kms"
  environment = var.environment
}

module "dynamodb" {
  source      = "./modules/dynamodb"
  environment = var.environment
  kms_key_arn = module.kms.key_arn
}

module "sqs" {
  source      = "./modules/sqs"
  environment = var.environment
  kms_key_arn = module.kms.key_arn
}

module "iam" {
  source               = "./modules/iam"
  environment          = var.environment
  aws_region           = var.aws_region
  github_org           = var.github_org
  github_repo          = var.github_repo
  alerts_table_arn     = module.dynamodb.alerts_table_arn
  gazettes_table_arn   = module.dynamodb.gazettes_table_arn
  suppliers_table_arn  = module.dynamodb.suppliers_table_arn
  entities_table_arn   = module.dynamodb.entities_table_arn
  newsletter_table_arn = module.dynamodb.newsletter_table_arn
  costs_table_arn      = module.dynamodb.costs_table_arn
  gazettes_queue_arn   = module.sqs.gazettes_queue_arn
  alerts_queue_arn     = module.sqs.alerts_queue_arn
  kms_key_arn          = module.kms.key_arn
}

module "lambdas" {
  source                = "./modules/lambdas"
  environment           = var.environment
  analyzer_role_arn     = module.iam.analyzer_role_arn
  publisher_role_arn    = module.iam.publisher_role_arn
  api_role_arn          = module.iam.api_role_arn
  costs_role_arn        = module.iam.costs_role_arn
  costs_table_name      = module.dynamodb.costs_table_name
  gazettes_queue_arn    = module.sqs.gazettes_queue_arn
  alerts_queue_arn      = module.sqs.alerts_queue_arn
  alerts_queue_url      = module.sqs.alerts_queue_url
  x_enabled             = var.x_enabled
  x_dry_run             = var.x_dry_run
  reddit_enabled        = var.reddit_enabled
  reddit_dry_run        = var.reddit_dry_run
  web_revalidate_secret = module.web.revalidate_secret_value
}

module "eventbridge" {
  source           = "./modules/eventbridge"
  environment      = var.environment
  costs_lambda_arn = module.lambdas.costs_arn
}

module "monitoring" {
  source            = "./modules/monitoring"
  gazettes_dlq_name = module.sqs.gazettes_dlq_name
  alerts_dlq_name   = module.sqs.alerts_dlq_name
  alert_email       = var.alert_email
}

module "web" {
  source         = "./modules/web"
  hosted_zone_id = "Z0950975SSMZZW5DEN8A"
  api_url        = module.lambdas.api_url
}

module "gazettes_cache" {
  source         = "./modules/gazettes-cache"
  environment    = var.environment
  aws_region     = var.aws_region
  hosted_zone_id = "Z0950975SSMZZW5DEN8A"
}

# AI SEO Onda 2 §5.1 — subdomain api.fiscaldigital.org via CloudFront na frente
# da Lambda Function URL. Habilita LLMs/agentes referenciarem URL estável
# (OpenAPI servers, ai-plugin manifest, etc).
#
# Substituir a função URL crua (`...lambda-url.us-east-1.on.aws`) pelo
# subdomain após apply:
#   - Atualizar `fiscal-digital-web/lib/api.ts` (NEXT_PUBLIC_API_URL fallback)
#   - Atualizar `messages/*.json` se houver referência hardcoded
#   - Validar com `curl -I https://api.fiscaldigital.org/health`
module "api_domain" {
  source         = "./modules/api-domain"
  hosted_zone_id = "Z0950975SSMZZW5DEN8A"
  # Lambda Function URL retorna `https://<id>.lambda-url.<region>.on.aws/`.
  # Removemos protocolo e trailing slash para CloudFront origin domain_name.
  lambda_function_url_domain = replace(replace(module.lambdas.api_url, "https://", ""), "/", "")
}

# ─── SSM Parameters — publish thresholds (TEC-ENG-002) ───────────────────────
# Alterar thresholds sem redeploy: aws ssm put-parameter --overwrite --name X --value Y

resource "aws_ssm_parameter" "publish_risk_threshold" {
  name  = "/fiscal-digital/prod/publish-risk-threshold"
  type  = "String"
  value = "60"

  lifecycle {
    ignore_changes = [value] # alterações via CLI não são revertidas pelo Terraform
  }
}

resource "aws_ssm_parameter" "publish_confidence_threshold" {
  name  = "/fiscal-digital/prod/publish-confidence-threshold"
  type  = "String"
  value = "0.70"

  lifecycle {
    ignore_changes = [value]
  }
}

# MIT-02 / EVO-002: feature flag para analyzer escrever em suppliers-prod.
# Default false: deploy entra "dark", flip para true quando smoke validar.
# Rollback: aws ssm put-parameter --overwrite --name .../enable-supplier-write --value false
resource "aws_ssm_parameter" "enable_supplier_write" {
  name  = "/fiscal-digital/prod/enable-supplier-write"
  type  = "String"
  value = "false"

  lifecycle {
    ignore_changes = [value]
  }
}

# FiscalFornecedores v2 — concentracao 12m via GSI2_ConcentracaoSecretaria.
# DESLIGADO por default. Ativar APENAS apos:
#   1. Ciclo 4 de observacao concluido (janela ate 2026-06-10)
#   2. Canary validado em Caxias do Sul + Porto Alegre
#   3. Aprovacao de Diego
#
# Para ativar:
#   aws ssm put-parameter --overwrite \
#     --name /fiscal-digital/prod/enable-fiscal-fornecedores-v2 \
#     --value true --type String
#
# Para reverter:
#   aws ssm put-parameter --overwrite \
#     --name /fiscal-digital/prod/enable-fiscal-fornecedores-v2 \
#     --value false --type String
resource "aws_ssm_parameter" "enable_fiscal_fornecedores_v2" {
  name        = "/fiscal-digital/prod/enable-fiscal-fornecedores-v2"
  type        = "String"
  value       = "false"
  description = "Feature flag FiscalFornecedores v2. Ativar APENAS apos validacao Ciclo 4 + canary Caxias."

  lifecycle {
    ignore_changes = [value]
  }
}

# ─── State reconciliation (P0 2026-07-19, ERR-20260719-001) ─────────────────
# Causa raiz REAL dos P0 de 2026-06-07 e 2026-07-19: o Sid WebS3BucketRead
# (s3:ListBucket no bucket web) foi perdido no cleanup A4 de 2026-06-06.
# HeadBucket exige s3:ListBucket; o refresh lia 403 como "bucket deletado",
# o plan tentava recriar o bucket existente e destruia policy + PAB por
# replace. Fix na policy da role CI (modules/iam/main.tf, Sid WebS3BucketRead).
# Os import blocks de policy + PAB (PR #91) sairam: o apply de 2026-07-19
# (run 29685210890) os destruiu na AWS e import de objeto inexistente falha
# o plan. O apply os recria como create normal, restaurando o acesso OAC.
# O import do bucket abaixo e defesa em profundidade: no-op enquanto o bucket
# estiver no state; se algum dia sair, reimporta em vez de recriar em cascata.
import {
  to = module.web.aws_s3_bucket.web
  id = "fiscal-digital-web-prod"
}
