<!-- legal-verified -->
# ADR-2026-06-06-A4 -- Limpeza da Role Compartilhada Apos A3+A3b

**Status:** Accepted
**Data:** 2026-06-06
**Autor:** Diego Moreira Vieira

---

## Contexto

Sprints A3 (PRs #82+#83) e A3b (PR #86) criaram roles OIDC dedicadas para os repos
`fiscal-digital-collectors` e `fiscal-digital-web`, respectivamente, usando o pattern
de coexistencia segura (LRN-20260606-005): as roles dedicadas foram criadas e validadas
em producao antes de remover os Sids correspondentes da role compartilhada.

Com ambas as roles dedicadas validadas e funcionando, Sprint A4 executa a limpeza:
remocao dos Sids da role compartilhada `fiscal-digital-github-actions-prod` que agora
sao exclusivos das roles dedicadas.

---

## Audit dos Sids (role `fiscal-digital-github-actions-prod`)

### Sids REMOVIDOS (2)

**`WebS3Deploy`** (categoria: WEB)
- Acoes: `s3:GetObject/PutObject/DeleteObject/ListBucket/GetBucketLocation` em `fiscal-digital-web-prod`
- Motivo da remocao: somente o CI do repo `fiscal-digital-web` faz sync de assets
  para esse bucket. O monorepo gerencia a _infraestrutura_ do bucket (via `aws_s3_bucket`
  no modulo `web/`) mas nao faz upload de objetos. A role dedicada `fiscal-digital-github-actions-web-prod`
  cobre essa necessidade via Sid `WebS3Sync`.
- Confirmado: `deploy.yml` e `plan.yml` do monorepo nao referenciam `fiscal-digital-web-prod`
  em operacoes de objeto.

**`WebCloudFrontInvalidate`** (categoria: WEB)
- Acoes: `cloudfront:CreateInvalidation/GetDistribution/ListDistributions` (Resource `*`)
- Motivo da remocao: invalidacao de cache CloudFront e acao de deploy do web (pos-sync S3).
  O `terraform apply` do monorepo gerencia _recursos_ CloudFront (criar/atualizar
  distribuicoes via `WebCloudFrontManage`) mas nunca chama `CreateInvalidation`.
  A role dedicada web cobre via Sid `WebCloudFrontInvalidate`.
- Confirmado: nenhum workflow do monorepo chama `cloudfront:CreateInvalidation`.

### Sids MANTIDOS (raciocinio documentado para os potencialmente ambiguos)

**`SecretsManagerWebRevalidate`** -- MANTER
O modulo `web/main.tf` do monorepo cria e gerencia o secret `fiscal-digital-revalidate-token-prod`
via recurso `aws_secretsmanager_secret`. O `terraform apply` precisa dessas permissoes.
Nao e duplicado: a role web dedicada nao tem acesso a este secret.

**`WebS3BucketManage`** -- MANTER
Terraform gerencia o recurso `aws_s3_bucket.web` (criar/configurar o bucket).
Operacoes de gerencia de bucket (policy, public access block, etc.) sao distintas
de operacoes de objeto (sync). O monorepo precisa para `terraform apply`.

**`WebCloudFrontManage`** -- MANTER
Terraform cria e atualiza a distribuicao CloudFront do site (recurso
`aws_cloudfront_distribution.web` no modulo `web/`). O monorepo precisa
para `terraform apply`. Distinto de invalidacao (que e operacao de deploy
do site, nao de infra).

**`CloudFrontResponseHeadersPolicy`** -- MANTER
Usado pelo modulo `gazettes-cache/` do monorepo (nao e recurso web).

**`CloudFrontFunctions`** -- MANTER
Terraform gerencia funcoes CloudFront para o site (locale redirect, etc.)
via modulo `web/`. Necessario para `terraform apply`.

**`CloudFrontOriginAndCachePolicies`** -- MANTER
Usado pelo modulo `api-domain/` do monorepo para a distribuicao de
`api.fiscaldigital.org`. Nao e exclusivo do repo web.

**`ACMManage` e `Route53Manage`** -- MANTER
Terraform cria certificados ACM e registros DNS para `fiscaldigital.org`,
`api.fiscaldigital.org` e `gazettes.fiscaldigital.org`. Necessario para
`terraform apply` do monorepo.

**`LambdaDeploy`** -- MANTER (candidato a refinamento futuro)
Recurso `fiscal-digital-*` inclui funcoes `fiscal-digital-web-isr-prod` e
`fiscal-digital-web-isr-revalidate-prod`. O monorepo usa esse Sid para
deployar analyzer/publisher/api/costs. Possivel refinamento: restringir a
`fiscal-digital-analyzer-*|publisher-*|api-*|costs-*`. Deixado para sprint
futura por ser refinamento, nao remocao.

---

## Decisao

Remocao de exatamente 2 Sids da role compartilhada:
- `WebS3Deploy`
- `WebCloudFrontInvalidate`

Nenhuma alteracao nas roles dedicadas (`github_actions_collectors` e
`github_actions_web`). Nenhuma alteracao na trust policy da role compartilhada
(remocao de `fiscal-digital-web` e `fiscal-digital-collectors` do trust e
sprint futura -- aguarda confirmacao que os repos atualizaram `AWS_ROLE_ARN`).

---

## Consequencias

**Positivas:**
- Role compartilhada perde 2 Sids excessivos (de 28 para 26)
- `WebS3Deploy` eliminava anonimato de acesso: qualquer repo assumindo a role
  compartilhada podia sobrescrever o site. Removido.
- `WebCloudFrontInvalidate` similarmente: acesso a invalidacao de cache do site
  era desnecessario para pipelines do monorepo

**Risco residual mitigado:**
- Se o CI do monorepo quebrar por `AccessDenied` em S3 web ou CF invalidation,
  o terraform plan na PR sinalizara. Revert via PR e rapido.
- Trust policy ainda permite que repos web e collectors assumam a role compartilhada --
  isso so e risco se o secret `AWS_ROLE_ARN` desses repos ainda aponta para ela.
  A confirmar que web e collectors ja migraram para roles dedicadas.

---

## Validacao

- CI desta PR (terraform plan) mostra apenas remocao dos 2 Sids na inline policy
- Nenhum recurso criado ou destruido (apenas restricao de permissions)
- Re-run de workflow do monorepo apos merge confirma funcionamento

---

## Relacionados

- PRs #82, #83: Sprint A3 -- role dedicada collectors
- PR #86: Sprint A3b -- role dedicada web
- ADR-2026-06-06-A3-collectors-iam-role-separation.md
- ADR-2026-06-06-A3b-web-iam-role-separation.md
- LRN-20260606-005: pattern de coexistencia segura
- LRN-20260606-007: delta de permissoes web vs. collectors
- LRN-20260606-009: licoes aprendidas deste cleanup (ver `.learnings/LEARNINGS.md`)
