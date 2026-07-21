data "aws_caller_identity" "current" {}

resource "aws_kms_key" "main" {
  description             = "Fiscal Digital — chave de criptografia principal"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  # Policy explícita = default (root full access) + CloudWatch Alarms.
  # Alarme publicando em tópico SNS criptografado precisa de Decrypt/
  # GenerateDataKey na CMK — sem isso o publish falha silenciosamente
  # (o alarme dispara e a notificação nunca chega).
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnableRootAccount"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "AllowCloudWatchAlarmsPublish"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = ["kms:Decrypt", "kms:GenerateDataKey*"]
        Resource  = "*"
      }
    ]
  })
}

resource "aws_kms_alias" "main" {
  name          = "alias/fiscal-digital-kms-prod"
  target_key_id = aws_kms_key.main.key_id
}
