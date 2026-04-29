resource "aws_kms_key" "main" {
  description             = "Fiscal Digital — chave de criptografia principal"
  deletion_window_in_days = 7
  enable_key_rotation     = true
}

resource "aws_kms_alias" "main" {
  name          = "alias/fiscal-digital-kms-prod"
  target_key_id = aws_kms_key.main.key_id
}
