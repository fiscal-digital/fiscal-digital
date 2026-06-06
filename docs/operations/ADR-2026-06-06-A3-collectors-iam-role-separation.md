<!-- legal-verified -->
# ADR-2026-06-06-A3 — Separação de Role IAM para o Repo fiscal-digital-collectors

**Status:** Accepted (retroativo)
**Data:** 2026-06-06
**Autor:** Diego Moreira Vieira

---

## Contexto

Antes desta mudança, o CI do repositório `fiscal-digital-collectors` usava a mesma role OIDC do monorepo principal (`fiscal-digital-github-actions-prod`). Essa role tem acesso amplo: todas as Lambdas, tabelas DynamoDB, Bedrock, SQS e o estado remoto do Terraform.

A auditoria A2 (2026-06-06) identificou que o Sid `IAMUpdateAssumeRolePolicySelf` nessa role tinha escopo `fiscal-digital-*` — o que significa que um comprometimento do CI do repo collectors poderia modificar a trust policy da role do monorepo principal, escalando privilégios para o ambiente inteiro. Risco classificado como **crítico**.

---

## Decisão

Criação de role IAM dedicada para o CI do repo `fiscal-digital-collectors`, com trust policy escopada exclusivamente a `repo:fiscal-digital/fiscal-digital-collectors:*` via OIDC.

**Recursos criados/alterados:**

- Nova role: `fiscal-digital-github-actions-collectors-prod`
  - Trust policy: `repo:fiscal-digital/fiscal-digital-collectors:*` (OIDC GitHub Actions)
  - Permissões: subconjunto mínimo necessário para deploy de Lambdas coletoras (`lambda:UpdateFunctionCode`, `lambda:GetFunction`, `lambda:ListTags`, `lambda:TagResource`, `lambda:UntagResource`, `s3:PutObject` no bucket de artefatos, `sts:GetCallerIdentity`)
- Secret `AWS_ROLE_ARN` no repositório `fiscal-digital-collectors`: atualizado para a nova role
- Role antiga `fiscal-digital-github-actions-prod`: permanece inalterada (usada pelo monorepo + fiscal-digital-web)

**Implementação via IaC:** PR #82 (criação da role) + PR #83 (correção de gap `lambda:ListTags` descoberto via CI scoped failing). Ambos mergeados em `main` e aplicados via `terraform apply` no pipeline de deploy.

**Pattern de coexistência segura:** as duas roles coexistem durante o período de observação (~dias). Sids duplicados na role antiga (`fiscal-digital-github-actions-prod`) referentes a permissões exclusivas de collectors serão removidos em Sprint A4, após confirmação de estabilidade.

---

## Consequências

**Positivas:**

- Blast radius reduzido: comprometimento do CI do repo collectors não afeta o monorepo principal nem o fiscal-digital-web
- Least-privilege aplicado: role collectors tem apenas as permissões necessárias para seu escopo
- Separação de responsabilidades: cada repo tem sua própria identidade de CI no AWS
- Trust policy escopada por repo elimina a possibilidade de lateral movement entre repositórios via OIDC

**Negativas:**

- Uma role IAM a mais para gerenciar
- Período de transição com permissões duplicadas na role antiga (mitiga-se via limpeza em Sprint A4)

**Riscos residuais:**

- Se permissões adicionais forem necessárias para collectors no futuro, podem ser adicionadas na role errada por engano — mitigado pelo módulo IAM explícito no Terraform
- Limpeza A4 (remoção de Sids duplicados da role antiga) ainda não realizada

---

## Validação

- CI do repo `fiscal-digital-collectors` executou com SUCCESS usando a nova role (`AWS_ROLE_ARN` atualizado)
- PR #83 corrigiu gap `lambda:ListTags` identificado pelo CI scoped failing — gap descoberto via CI antes de afetar produção
- Nenhum impacto no CI do monorepo ou do fiscal-digital-web (roles distintas, sem alteração)

---

## Lição

O privilege escalation via role compartilhada era um risco documentado desde o início, mas não teve PR/runbook prévio no bootstrap. Para próximos onboardings de repositório novo ao CI AWS: criar role dedicada na mesma PR que adiciona o workflow OIDC — nunca reusar role de outro repositório como atalho temporário. Ver regra: `feedback_aws_cli_destructive_no_pr.md`.

---

## Relacionados

- PR #82: [feat(iam): role separada para fiscal-digital-collectors via OIDC](https://github.com/fiscal-digital/fiscal-digital/pull/82)
- PR #83: [fix(iam): ListTags/TagResource/UntagResource em event-source-mapping da role collectors](https://github.com/fiscal-digital/fiscal-digital/pull/83)
- LRN registrado: `LRN-20260606-005` (`.learnings/LEARNINGS.md`)
- Sprint A2 ADR: [ADR-2026-06-06-A2-bootstrap-policies-cleanup.md](ADR-2026-06-06-A2-bootstrap-policies-cleanup.md)
- Módulo IAM collectors: `terraform/modules/iam/main.tf`
