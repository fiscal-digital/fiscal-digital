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
}

resource "aws_dynamodb_table" "suppliers" {
  name         = "fiscal-digital-suppliers-prod"
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
}
