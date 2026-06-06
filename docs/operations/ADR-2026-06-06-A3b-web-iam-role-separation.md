<!-- legal-verified -->
# ADR-2026-06-06-A3b -- Separacao de Role IAM para o Repo fiscal-digital-web

**Status:** Accepted
**Data:** 2026-06-06
**Autor:** Diego Moreira Vieira

---

## Contexto

Antes desta mudanca, o CI do repositorio `fiscal-digital-web` usava a mesma role OIDC do monorepo principal (`fiscal-digital-github-actions-prod`). Essa role tem acesso amplo: todas as Lambdas do monorepo, tabelas DynamoDB, SQS, KMS, Bedrock, IAM gerencial completo e estado remoto do Terraform.

O CI do web precisa de um subconjunto minimo: sync S3 para o bucket ISR, `lambda:UpdateFunctionCode` para duas funcoes especificas e `cloudfront:CreateInvalidation`. A auditoria dos workflows (`.github/workflows/deploy.yml` e `test-e2e.yml`) confirmou:

- `deploy.yml`: `aws s3 sync` para `fiscal-digital-web-prod`, `lambda update-function-code` para `fiscal-digital-web-isr-prod` e `fiscal-digital-web-isr-revalidate-prod`, e `cloudfront create-invalidation`.
- `test-e2e.yml`: nao usa AWS (testa contra prod read-only via Playwright).

O delta de permissoes e grande: a role compartilhada tem `lambda:*`, `dynamodb:*`, `sqs:*`, `kms:*`, `iam:*` gerencial e Bedrock. A role web precisa de apenas 3 Sids especificos.

---

## Decisao

Criacao de role IAM dedicada para o CI do repo `fiscal-digital-web`, com trust policy escopada exclusivamente a `repo:fiscal-digital/fiscal-digital-web:*` via OIDC.

**Recursos criados/alterados:**

- Nova role: `fiscal-digital-github-actions-web-prod`
  - Trust policy: `repo:fiscal-digital/fiscal-digital-web:*` (OIDC GitHub Actions)
  - `WebS3Sync`: `s3:GetObject/PutObject/DeleteObject/ListBucket` em `arn:aws:s3:::fiscal-digital-web-prod` e `fiscal-digital-web-prod/*`
  - `WebLambdaDeploy`: `lambda:UpdateFunctionCode` + `lambda:GetFunction` em `fiscal-digital-web-*`
  - `WebCloudFrontInvalidate`: `cloudfront:CreateInvalidation/GetDistribution/ListDistributions` (Resource `*` -- API CloudFront nao suporta resource-level nessas acoes)
- Secret `AWS_ROLE_ARN` no repositorio `fiscal-digital-web`: atualizado para a nova role via `gh secret set`
- Role antiga `fiscal-digital-github-actions-prod`: permanece inalterada (usada pelo monorepo)

**Implementacao via IaC:** PR no monorepo com o bloco terraform + ADR + LRN. `terraform apply` via pipeline de deploy apos merge.

**Pattern de coexistencia segura (LRN-20260606-005):** role compartilhada permanece intacta. Sids web na role antiga (`WebS3Deploy`, `WebCloudFrontInvalidate`, `WebS3BucketManage`, `WebCloudFrontManage`, etc.) serao removidos em Sprint A4.

---

## Consequencias

**Positivas:**

- Blast radius reduzido: comprometimento do CI do web nao afeta Lambdas do monorepo, DynamoDB, SQS, Bedrock ou IAM gerencial
- Role com apenas 3 Sids vs. 25+ Sids da role compartilhada -- reducao dramatica de superficie de ataque
- Menor privilegio aplicado: acesso estritamente necessario para o ciclo de deploy do site
- Trust policy escopada por repo elimina lateral movement via OIDC entre repositorios

**Negativas:**

- Uma role IAM adicional para gerenciar
- Periodo de transicao com permissoes duplicadas na role antiga (mitiga-se via limpeza em Sprint A4)

**Observacao relevante:** O delta de permissoes entre o que o web PRECISA e o que a role compartilhada TINHA e muito maior do que o caso dos collectors (Sprint A3). Collectors precisavam de Lambda+SQS+IAM de workload. Web precisa de S3+Lambda(update-code)+CloudFront apenas. Esse achado evidencia o quanto a role compartilhada estava over-privileged para o escopo do web.

---

## Validacao

- CI do repo `fiscal-digital-web` executou com SUCCESS usando a nova role (`AWS_ROLE_ARN` atualizado)
- Nenhum impacto no CI do monorepo (role distinta, sem alteracao)

---

## Licao

Para futuros onboardings de repositorio novo ao CI AWS: criar role dedicada na mesma PR que adiciona o workflow OIDC, com auditoria previa dos workflows para identificar as permissoes minimas necessarias. Nunca reusar role de outro repositorio como atalho temporario.

Ver tambem: `feedback_aws_cli_destructive_no_pr.md` -- mudancas destrutivas em prod exigem PR + runbook previa.

---

## Relacionados

- PR (Sprint A3b): feat(iam): role separada para fiscal-digital-web (Sprint A3b)
- PR #82: feat(iam): role separada para fiscal-digital-collectors via OIDC (Sprint A3)
- PR #83: fix(iam): ListTags/TagResource/UntagResource em event-source-mapping da role collectors
- LRN-20260606-005: Separacao de role IAM cross-repo via coexistencia segura
- LRN-20260606-007: Delta de permissoes web vs. collectors (`.learnings/LEARNINGS.md`)
- Sprint A3 ADR: [ADR-2026-06-06-A3-collectors-iam-role-separation.md](ADR-2026-06-06-A3-collectors-iam-role-separation.md)
- Modulo IAM: `terraform/modules/iam/main.tf`
