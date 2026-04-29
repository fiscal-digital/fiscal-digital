aws_region  = "us-east-1"
environment = "prod"

github_org  = "fiscal-digital"
github_repo = "fiscal-digital"

# Secret 'fiscaldigital-anthropic-prod' é resolvido automaticamente pelo Terraform
# via data lookup. Criar antes do primeiro apply:
#   aws secretsmanager create-secret \
#     --name fiscaldigital-anthropic-prod \
#     --secret-string '{"api_key":"sk-ant-..."}'
