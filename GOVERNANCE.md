# Governança — Fiscal Digital

## Modelo de governança

```
Core Maintainers
  → merge em main, releases, decisões técnicas e de publicação

Reviewers (por área)
  → aprovam PRs na sua área de especialização
  → convidados após contribuições consistentes

Contribuidores
  → qualquer pessoa via fork + PR
```

## Tomada de decisão

- Mudanças técnicas rotineiras: aprovação de 1 maintainer
- Mudanças em lógica de detecção de Fiscais: aprovação de 1 maintainer + 1 reviewer da área
- Adição de nova cidade: aprovação de 1 maintainer após verificação de cobertura QD
- Decisões estratégicas: discussão pública em GitHub Discussions antes de implementar

## Proteção do branch main

- Push direto proibido — apenas via PR
- Mínimo 1 aprovação obrigatória
- CI deve passar (lint + testes + terraform plan)
- Histórico linear (squash merge)

## Responsabilidade editorial

Todo alerta publicado é responsabilidade dos maintainers.
Fiscais detectam — maintainers são responsáveis pelo conteúdo publicado.

A arquitetura exige `confidence >= 0.70` e `riskScore >= 60` para publicação automática.
Alertas com `riskScore >= 85` são priorizados para revisão manual quando possível.

## Tornando-se Reviewer

Contribuidores que tiverem 3+ PRs merged de qualidade podem ser convidados como Reviewers
da área correspondente (ex: Fiscal de Licitações, Coletor Porto Alegre).

## Tornando-se Core Maintainer

Por convite após contribuição sustentada e alinhamento com os princípios do projeto.
