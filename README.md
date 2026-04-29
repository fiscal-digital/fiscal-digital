# Fiscal Digital

**Agente autônomo de fiscalização de gastos públicos municipais no Brasil.**

Fiscal Digital monitora diários oficiais municipais, detecta irregularidades e publica alertas verificáveis para a sociedade — sempre com a fonte citada.

🌐 [fiscaldigital.org](https://fiscaldigital.org) · 🐦 [@FiscalDigital](https://x.com/FiscalDigital)

---

## Como funciona

```
Diário Oficial Municipal (via Querido Diário)
           ↓
    Extração de entidades
    (regex + Claude Haiku)
           ↓
    Fiscais Autônomos
  ┌─────────────────────┐
  │ Fiscal Licitações   │ → detecta dispensas, fracionamentos
  │ Fiscal Contratos    │ → detecta aditivos abusivos
  │ Fiscal Fornecedores │ → detecta CNPJs suspeitos, concentração
  │ Fiscal Pessoal      │ → detecta picos de nomeações
  └─────────────────────┘
           ↓
    Score de risco (0–100)
           ↓
  Alerta público com fonte
  X · Reddit · Dashboard
```

Todo alerta inclui o link para o diário oficial original no [Querido Diário](https://queridodiario.ok.org.br). Nunca publicamos sem evidência verificável.

---

## Cidades monitoradas

| Cidade | Estado | Cobertura |
|---|---|---|
| Caxias do Sul | RS | Jan/2021 → presente |
| Porto Alegre | RS | Em breve |

---

## Repositórios

| Repo | Descrição |
|---|---|
| **fiscal-digital** *(este)* | Engine: Fiscais, Skills, API, Terraform |
| [fiscal-digital-web](https://github.com/vieiradiego/fiscal-digital-web) | Site e dashboards públicos |
| [fiscal-digital-collectors](https://github.com/vieiradiego/fiscal-digital-collectors) | Coletores de fontes de dados |
| [fiscal-digital-analytics](https://github.com/vieiradiego/fiscal-digital-analytics) | Análises e relatórios |

---

## Inspiração

Este projeto é diretamente inspirado por:

- **[Serenata de Amor](https://serenata.ai)** (OKFN Brasil) — pioneira em IA para fiscalização pública no Brasil
- **[Querido Diário](https://queridodiario.ok.org.br)** (OKFN Brasil) — infraestrutura de dados abertos que torna este projeto possível

---

## Contribuindo

Leia o [Guia de Contribuição](CONTRIBUTING.md) e o [Código de Conduta](CODE_OF_CONDUCT.md).

Para adicionar uma nova cidade ou um novo Fiscal, abra uma [Issue](https://github.com/vieiradiego/fiscal-digital/issues/new/choose) primeiro — toda mudança em lógica de detecção precisa de referência legal.

---

## Licença

[AGPL-3.0](LICENSE) — código aberto, derivações devem permanecer abertas.

Dados gerados: [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)
