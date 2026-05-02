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
  source              = "./modules/iam"
  environment         = var.environment
  aws_region          = var.aws_region
  github_org          = var.github_org
  github_repo         = var.github_repo
  alerts_table_arn    = module.dynamodb.alerts_table_arn
  gazettes_table_arn  = module.dynamodb.gazettes_table_arn
  suppliers_table_arn = module.dynamodb.suppliers_table_arn
  entities_table_arn  = module.dynamodb.entities_table_arn
  gazettes_queue_arn  = module.sqs.gazettes_queue_arn
  alerts_queue_arn    = module.sqs.alerts_queue_arn
  kms_key_arn         = module.kms.key_arn
}

module "lambdas" {
  source             = "./modules/lambdas"
  environment        = var.environment
  collector_role_arn = module.iam.collector_role_arn
  analyzer_role_arn  = module.iam.analyzer_role_arn
  publisher_role_arn = module.iam.publisher_role_arn
  api_role_arn       = module.iam.api_role_arn
  gazettes_queue_arn = module.sqs.gazettes_queue_arn
  alerts_queue_arn   = module.sqs.alerts_queue_arn
  gazettes_queue_url = module.sqs.gazettes_queue_url
  alerts_queue_url   = module.sqs.alerts_queue_url
  x_enabled          = var.x_enabled
  x_dry_run          = var.x_dry_run
  reddit_enabled     = var.reddit_enabled
  reddit_dry_run     = var.reddit_dry_run
}

module "eventbridge" {
  source               = "./modules/eventbridge"
  environment          = var.environment
  collector_lambda_arn = module.lambdas.collector_arn
  collector_role_arn   = module.iam.collector_role_arn
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
