# Auditoria mensal de confiabilidade — escopo fixo

Você está rodando no GH Actions com credenciais AWS **read-only** (role
`fiscal-digital-audit-ro`) e `gh` autenticado. Execute EXATAMENTE este escopo —
nada além dele — e publique o resultado como comentário na issue de rastreio
**#153** deste repo.

## Regras invioláveis

1. **Zero escrita na AWS.** A role já impede, mas não tente: sem put/delete/update,
   sem mudar flag, sem disparar workflow. Você só LÊ e comenta na issue.
2. Todo número reportado vem de comando executado nesta sessão. Sem medição, sem
   afirmação.
3. Não abra issues novas nem edite as existentes — só o comentário em #153.
4. Formato: denso, tabelas, PT-BR. Sem narração de processo.

## Escopo (nesta ordem)

1. **Flags e thresholds** — `aws ssm get-parameters` em
   `/fiscal-digital/prod/{enable-supplier-write,enable-fiscal-fornecedores-v2,publish-risk-threshold,publish-confidence-threshold}`.
   Reportar valor + LastModifiedDate + mudanças vs auditoria anterior.
2. **Alarmes** — `aws cloudwatch describe-alarms`: dos alarmes `fiscal-digital-*`,
   quantos existem, estado atual, algum sem `AlarmActions`?
3. **Filas** — `aws sqs get-queue-attributes` das filas `fiscal-digital-*`:
   mensagens visíveis e em DLQ (DLQ > 0 é achado).
4. **Gate de publicação** — scan de `fiscal-digital-alerts-prod` (itens `FINDING#`):
   total, quantos passam `riskScore>=60 && confidence>=0.70`, por fiscalId.
   Comparar com o comentário da auditoria anterior em #153.
5. **Frescor** — ler as issues abertas `[sentinela]` no repo collectors (não
   recalcular do zero — a sentinela é a fonte); resumir quantas cidades estagnadas.
6. **PRs e branches** — `gh pr list` nos repos engine/collectors/web/evaluations:
   abertos há mais de 14 dias, gates vermelhos.
7. **Milestone "Religar publicação"** — progresso (issues abertas/fechadas),
   P0s ainda abertos.
8. **Diff** — localizar o comentário da auditoria anterior em #153 (título
   "## Auditoria mensal") e reportar SÓ o que mudou; primeira execução = baseline.

## Saída

Um único comentário em #153 começando com `## Auditoria mensal — <YYYY-MM>`,
seções na ordem do escopo, tabela de diff no fim, e uma linha final:
`Próxima: dia 1 do mês seguinte. Custo desta execução: ~<tokens> tokens.`
