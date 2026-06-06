<!-- legal-verified -->
# ADR-2026-06-06-A2 — Remoção de Inline Policies Bootstrap da Role GitHub Actions

**Status:** Accepted (retroativo)
**Data:** 2026-06-06
**Autor:** Diego Moreira Vieira

---

## Contexto

Ao realizar a auditoria de permissões da role `fiscal-digital-github-actions-prod` (Sprint A2), foram identificadas 4 inline policies criadas manualmente durante o bootstrap inicial do CI (fall/2025), antes de o módulo Terraform `terraform/modules/iam/main.tf` existir:

- `bootstrap-checkov`
- `bootstrap-iam-read`
- `bootstrap-tfstate`
- `bootstrap-misc`

Essas policies estavam **fora do IaC** — não existiam como `aws_iam_role_policy` no Terraform — e duplicavam permissões já cobertas pelo módulo IAM atual. A duplicação criava risco de deriva silenciosa: qualquer expansão futura do módulo poderia entrar em conflito com grants legados invisíveis ao `terraform plan`.

A operação foi executada via AWS CLI direto, sem PR prévio nem runbook formal — violando o princípio de que mudanças sensitivas em recursos AWS exigem PR + runbook + aprovação mesmo quando o recurso está órfão do IaC.

---

## Decisão

Remoção das 4 inline policies via `aws iam delete-role-policy` na role `fiscal-digital-github-actions-prod`.

**Recursos alterados:**

- Role: `fiscal-digital-github-actions-prod`
- Policies removidas: 4 inline policies com prefixo `bootstrap-*` (nomes exatos: `bootstrap-checkov`, `bootstrap-iam-read`, `bootstrap-tfstate`, `bootstrap-misc`)
- Nenhum recurso novo criado; nenhum arquivo Terraform alterado

**Motivação para execução imediata (sem PR):** as policies eram claros resíduos de bootstrap sem equivalente no IaC; a auditoria A2 identificou que o módulo IAM atual cobria todas as permissões necessárias. O risco de CI quebrado existia mas foi avaliado como baixo dado o mapeamento direto entre policies removidas e Sids existentes no módulo.

---

## Consequências

**Positivas:**

- Role `fiscal-digital-github-actions-prod` passa a ser 100% gerenciada pelo Terraform — nenhuma inline policy fora do IaC
- Elimina risco de deriva silenciosa entre grants legados e módulo atual
- `terraform plan` futuro reflete estado real completo da role

**Negativas:**

- Operação realizada sem PR — sem revisão por par, sem registro prévio de intenção

**Riscos residuais:**

- Se o módulo IAM tiver lacuna não detectada na auditoria, CI do monorepo pode falhar em permissões específicas num run futuro

---

## Validação

- 2 runs consecutivos de CI do monorepo (`plan.yml`) concluídos com SUCCESS após a remoção
- Nenhum `AccessDeniedException` ou `InsufficientPermissions` nos logs das Lambdas de produção nas 24h seguintes

---

## Lição

Na próxima operação deste tipo (remoção de resource IAM, mesmo órfão do IaC): abrir PR com diff descritivo + runbook de rollback antes de executar. Aprovação explícita do owner antes do `aws` CLI. Ver regra: `feedback_aws_cli_destructive_no_pr.md`.

---

## Relacionados

- LRN registrado: `LRN-20260606-005` (`.learnings/LEARNINGS.md`)
- Sprint A3 ADR: [ADR-2026-06-06-A3-collectors-iam-role-separation.md](ADR-2026-06-06-A3-collectors-iam-role-separation.md)
- Módulo IAM: `terraform/modules/iam/main.tf`
