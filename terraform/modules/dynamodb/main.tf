resource "aws_dynamodb_table" "alerts" {
  name         = "fiscal-digital-alerts-prod"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "cityId"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  attribute {
    name = "cnpj"
    type = "S"
  }

  attribute {
    name = "secretaria"
    type = "S"
  }

  attribute {
    name = "published"
    type = "S"
  }

  attribute {
    name = "riskScore"
    type = "N"
  }

  global_secondary_index {
    name            = "GSI1-city-date"
    hash_key        = "cityId"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2-cnpj-date"
    hash_key        = "cnpj"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI3-secretaria-date"
    hash_key        = "secretaria"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI4-risk-published"
    hash_key        = "published"
    range_key       = "riskScore"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
}

resource "aws_dynamodb_table" "gazettes" {
  name         = "fiscal-digital-gazettes-prod"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  attribute {
    name = "pk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
}

resource "aws_dynamodb_table" "suppliers" {
  name         = "fiscal-digital-suppliers-prod"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  # MIT-02 / EVO-002: schema cross-supplier
  # pk: SUPPLIER#{cnpj}
  # sk: {contractedAt}#{contractId} — cronológico + dedupe por contractId
  # Atributos: cityId, secretaria, valueAmount, contractType, sourceFindingId, capturedAt
  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "cityId"
    type = "S"
  }

  attribute {
    name = "contractedAt"
    type = "S"
  }

  # Cross-supplier por cidade — "contratos do CNPJ X em Caxias por data"
  global_secondary_index {
    name            = "GSI1-city-date"
    hash_key        = "cityId"
    range_key       = "contractedAt"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
}

# entities-prod — Cache de extração LLM (UH-22)
# pk: EXTRACTION#{gazetteId}#{md5(excerpt).slice(0,16)}
# Atributos: entities (Map), confidence (N), schemaVersion (N), cachedAt (S)
# TTL desabilitado — cache permanente, ~$0.03/mês para 200k entries
resource "aws_dynamodb_table" "entities" {
  name         = "fiscal-digital-entities-prod"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  attribute {
    name = "pk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
}

# costs-prod — Snapshots de custo AWS coletados pelo FiscalCustos (UH-OPS-001).
# pk: COST#DAILY#{YYYY-MM-DD} | COST#MONTHLY#{YYYY-MM} | COST#FX#{YYYY-MM-DD}
# Single-key. Histórico ≤ 90 dias é varredura barata. Sem GSI.
resource "aws_dynamodb_table" "costs" {
  name         = "fiscal-digital-costs-prod"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  attribute {
    name = "pk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
}

# newsletter-prod — Inscrições da newsletter
# pk: NEWSLETTER#{email_normalized} (lowercase + trim)
# Atributos: email (S), createdAt (S), confirmedAt (S?), source (S?),
#            locale (S, "pt"|"en"), unsubscribedAt (S?), ipHash (S?)
# Sem GSI no v1.0 — list paginado por scan basta para volume baixo.
resource "aws_dynamodb_table" "newsletter" {
  name         = "fiscal-digital-newsletter-prod"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  attribute {
    name = "pk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}
