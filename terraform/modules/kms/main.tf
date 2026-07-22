data "aws_caller_identity" "current" {}

resource "aws_kms_key" "main" {
  description             = "Fiscal Digital — chave de criptografia principal"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  # Policy explícita = default (root) + serviços que operam sobre o tópico SNS
  # criptografado. Ambos precisam de Decrypt/GenerateDataKey na CMK:
  #  - CloudWatch: publica alarmes no tópico (sem isso o alarme dispara e a
  #    notificação nunca chega).
  #  - SNS: processa/entrega mensagens do tópico, INCLUSIVE o e-mail de
  #    confirmação de subscription. Sem esta statement o SNS falha em silêncio
  #    e o e-mail de confirmação nunca é enviado (subscription fica Pending
  #    para sempre) — incidente 2026-07-22, faltava no #118.
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
      },
      {
        Sid       = "AllowSNSUseOfKey"
        Effect    = "Allow"
        Principal = { Service = "sns.amazonaws.com" }
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
