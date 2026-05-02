aws_region  = "us-east-1"
environment = "prod"

github_org  = "fiscal-digital"
github_repo = "fiscal-digital"

# ─── Canais de publicação ────────────────────────────────────────
# Reddit: habilitado com DRY_RUN=true até concluir RDT-01/02/05
reddit_enabled = "true"
reddit_dry_run = "true"

# X (@LiFiscalDigital): DRY_RUN=true valida credenciais sem postar
# Mudar x_dry_run para "false" após confirmar enrollment do app resolvido (LRN-006)
x_enabled  = "true"
x_dry_run  = "true"

# Secret 'fiscaldigital-anthropic-prod' é resolvido automaticamente pelo Terraform
# via data lookup. Criar antes do primeiro apply:
#   aws secretsmanager create-secret \
#     --name fiscaldigital-anthropic-prod \
#     --secret-string '{"api_key":"sk-ant-..."}'
