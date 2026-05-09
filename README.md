# Fiscal Digital

[![Deploy](https://github.com/fiscal-digital/fiscal-digital/actions/workflows/deploy.yml/badge.svg)](https://github.com/fiscal-digital/fiscal-digital/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Data License: CC BY 4.0](https://img.shields.io/badge/Data%20License-CC%20BY%204.0-blue.svg)](https://creativecommons.org/licenses/by/4.0/)

**Agente autônomo de fiscalização de gastos públicos municipais no Brasil.**

Fiscal Digital monitora diários oficiais municipais, detecta irregularidades e publica alertas verificáveis para a sociedade — sempre com a fonte citada.

🌐 [fiscaldigital.org](https://fiscaldigital.org) · 🐦 [@FiscalDigitalBR](https://x.com/FiscalDigitalBR) · 📰 RSS público em breve via `api.fiscaldigital.org`

---

## Como funciona

```
Diário Oficial Municipal (via Querido Diário)
           ↓
    Camada 1 — Regex (CNPJ, valores, datas)
           ↓
    Camada 2 — Nova Lite via Bedrock (extração e classificação)
           ↓
    10 Fiscais Autônomos (paralelos)
  ┌──────────────────────────────────┐
  │ Geral (orquestrador, padrão     │
  │   recorrente cross-gazette)      │
  │ Licitações       — Lei 14.133/21 │
  │ Contratos        — Lei 14.133/21 │
  │ Fornecedores     — RFB + CGU     │
  │ Pessoal          — Lei 9.504/97  │
  │ Convênios        — Lei 13.019/14 │
  │ Nepotismo        — STF SV 13     │
  │ Publicidade      — Lei 9.504/97  │
  │ Locação          — Lei 14.133/21 │
  │ Diárias          — Lei 8.112/90  │
  └──────────────────────────────────┘
           ↓
    Score de risco (0–100) + confiança (0–1)
           ↓
    Camada 3 — Haiku 4.5 via Bedrock (narrativa, riskScore ≥ 60)
           ↓
    Alerta público com fonte
    fiscaldigital.org · RSS · (X/Reddit em DRY_RUN)
```

Todo alerta inclui o link para o diário oficial original no [Querido Diário](https://queridodiario.ok.org.br). Nunca publicamos sem evidência verificável.

---

## Cidades monitoradas

**50 cidades ativas** + 2 planejadas (cobertura depende do Querido Diário ter o município indexado).

- **Origem do MVP:** Caxias do Sul (RS) — gestão Adiló Didomenico (2021–presente). Backfill completo.
- **Top 50 por população + todas as capitais:** São Paulo, Rio de Janeiro, Salvador, Brasília, Fortaleza, Belo Horizonte, Manaus, Curitiba, Recife, Porto Alegre... (lista completa em [`packages/engine/src/cities/index.ts`](packages/engine/src/cities/index.ts))

---

## Tipos de alerta (18)

`dispensa_irregular` · `fracionamento` · `aditivo_abusivo` · `prorrogacao_excessiva` · `cnpj_jovem` · `concentracao_fornecedor` · `pico_nomeacoes` · `rotatividade_anormal` · `inexigibilidade_sem_justificativa` · `padrao_recorrente` · `convenio_sem_chamamento` · `repasse_recorrente_osc` · `diaria_irregular` · `publicidade_eleitoral` · `locacao_sem_justificativa` · `nepotismo_indicio` · `cnpj_situacao_irregular` · `fornecedor_sancionado`

Mapeamento canônico PT/EN: [`packages/engine/src/types/index.ts`](packages/engine/src/types/index.ts) (`FindingType`).

---

## Repositórios

| Repo | Descrição |
|---|---|
| **fiscal-digital** *(este)* | Engine: Fiscais, Skills, API, Terraform |
| [fiscal-digital-web](https://github.com/fiscal-digital/fiscal-digital-web) | Site e dashboards públicos |
| [fiscal-digital-collectors](https://github.com/fiscal-digital/fiscal-digital-collectors) | Coletores de fontes de dados |
| [fiscal-digital-analytics](https://github.com/fiscal-digital/fiscal-digital-analytics) | Análises e relatórios |

---

## Transparência aplicada ao próprio projeto

**FiscalCustos** (agente operacional, não fiscaliza município) consulta diariamente o AWS Cost Explorer, persiste em DynamoDB e expõe em [`fiscaldigital.org/transparencia/custos`](https://fiscaldigital.org/transparencia/custos): mês corrente, projeção, breakdown por serviço, conversão USD→BRL via PTAX BCB. O mesmo padrão de verificabilidade que aplicamos a contratos públicos aplicamos aos nossos próprios custos.

---

## Inspiração

Este projeto é diretamente inspirado por:

- **[Serenata de Amor](https://serenata.ai)** (OKFN Brasil) — pioneira em IA para fiscalização pública no Brasil
- **[Querido Diário](https://queridodiario.ok.org.br)** (OKFN Brasil) — infraestrutura de dados abertos que torna este projeto possível

---

## Contribuindo

Leia o [Guia de Contribuição](CONTRIBUTING.md) e o [Código de Conduta](CODE_OF_CONDUCT.md).

Para adicionar uma nova cidade ou um novo Fiscal, abra uma [Issue](https://github.com/fiscal-digital/fiscal-digital/issues/new/choose) primeiro — toda mudança em lógica de detecção precisa de referência legal + exemplo positivo + exemplo negativo (regra de [GOVERNANCA.md](docs/fiscais/GOVERNANCA.md)).

---

## Licença

[MIT](LICENSE) — código aberto, derivações livres.

Dados gerados: [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)
