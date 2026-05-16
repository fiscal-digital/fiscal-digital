# Roadmap — Fiscal Digital

> Visão pública e estratégica do projeto. Para o backlog operacional detalhado, abra uma [Issue](https://github.com/fiscal-digital/fiscal-digital/issues) ou veja o [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Onde estamos hoje

| | |
|---|---|
| **Cidades monitoradas** | 50 ativas + 2 planejadas (22 estados) |
| **Fiscais ativos** | 10 agentes autônomos + 1 operacional ([FiscalCustos](https://fiscaldigital.org/transparencia/custos)) |
| **Diários processados** | ~50.000 |
| **Achados publicáveis** | ~180 (gate: confidence ≥ 0.70 e riskScore ≥ 60) |
| **Canal primário** | [fiscaldigital.org](https://fiscaldigital.org) (PT-BR/EN) + RSS + API REST pública |
| **Canais externos** | Reddit e X em modo `DRY_RUN` (bloqueios externos abertos) |

Pipeline diário rodando ponta-a-ponta: Querido Diário → Bedrock (Nova Lite + Haiku 4.5) → 10 Fiscais → publicação no site.

---

## Em curso

### Polimento de UX no feed de alertas
Filtros, paginação, ordenação e busca no `/alertas`. Páginas por cidade com KPIs reais. Foco: jornalista entra, encontra, clica, valida no diário oficial em 3 cliques.

### Hardening de testes (cobertura zero → mínima)
Suite Playwright E2E rodando contra produção (read-only, sem POST). PR-gate ativo. Próximas fases: vitest unit no site, contratos `engine ↔ web` via zod, smoke pós-deploy automático.

### Evolução de inteligência dos Fiscais
Recalibração rigorosa baseada em **golden set rotulado por humano** (não em heurística). Pré-requisito: persistir excerpts do Bedrock em DynamoDB para reanalyze barato. Avaliação publicada em [`fiscal-digital-evaluations`](https://github.com/fiscal-digital/fiscal-digital-evaluations) — uma ADR por Fiscal, baseline numérico por release.

### Descoberta agêntica (AI SEO)
Tornar Fiscal Digital **fonte primária citável** por LLMs com tool use. Três ondas:

| Onda | Conteúdo | Status |
|---|---|---|
| 1 | `llms.txt`, JSON-LD `Report` por alerta, citation headers, ETag/304, robots para bots de IA | 🔄 em deploy |
| 2 | OpenAPI 3.1, JSON-LD `Dataset` / `Place` / `Organization`, JSON Feed 1.1, sitemap especializado, markdown views por alerta, `.well-known/ai-plugin.json` | 🔲 planejando |
| 3 | MCP server público, bulk dump CSV/JSONL mensal, submissão ao Hugging Face Datasets | 🔲 futuro |

---

## Próximos marcos

| Marco | O que destrava | Quando |
|---|---|---|
| `api.fiscaldigital.org` formal (CNAME + cert) | Documentação OpenAPI estável; libera Onda 2 sem rewrite | curto prazo |
| 10/10 Fiscais com baseline numérico publicado | Permite detectar regressão em CI antes de merge | ~3 sprints |
| Reativação de canais externos (Reddit + X) | Resolver bloqueios externos (Reddit Responsible Builder, X Pay-Per-Use bug) | depende de terceiros |
| CNPJ alfanumérico (Lei 14.973/2024) | Atualização obrigatória em 5 Fiscais | antes de jul/2026 |

---

## Bloqueios externos (transparentes)

| Bloqueio | Aguardando |
|---|---|
| Reddit live: aprovação de Responsible Builder Policy | Reddit (sem ETA) |
| X live: bug de enrollment Pay-Per-Use (`POST /2/tweets` 403) | X support (sem ETA) |
| Indexação irregular do Querido Diário por spider | [okfn-brasil/querido-diario#1451](https://github.com/okfn-brasil/querido-diario/issues/1451) |

Esses bloqueios não impedem o pipeline. O site `fiscaldigital.org` é o canal primário hoje.

---

## Como ajudar agora

### 🛠️ Você é dev (TypeScript / AWS / Next.js)
- [Issues `for:dev`](https://github.com/fiscal-digital/fiscal-digital/issues?q=is%3Aissue+is%3Aopen+label%3Afor%3Adev)
- [Issues `good first issue`](https://github.com/fiscal-digital/fiscal-digital/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — rampa curta
- Stack principal: TypeScript strict, Node 24, AWS Lambda + DynamoDB + Bedrock, Terraform, Next.js 16 SSG, Playwright. Detalhes em [CLAUDE.md](CLAUDE.md).

### 📰 Você é cidadão ou jornalista
- [Issues `for:citizen`](https://github.com/fiscal-digital/fiscal-digital/issues?q=is%3Aissue+is%3Aopen+label%3Afor%3Acitizen)
- **Validar achados**: navegue [fiscaldigital.org/alertas](https://fiscaldigital.org/alertas), clique no diário oficial, confira o ato. Se algo estiver errado, abra issue com label `type:false-positive`.
- **Sugerir cobertura**: cidade que falta? Abra issue com template [`nova-cidade`](https://github.com/fiscal-digital/fiscal-digital/issues/new?template=nova-cidade.md).
- **Divulgar**: compartilhe alertas reais, ajude a comunidade a entender o que monitoramos.

### ⚖️ Você é especialista em direito público ou contratação
- [Issues `for:lawyer`](https://github.com/fiscal-digital/fiscal-digital/issues?q=is%3Aissue+is%3Aopen+label%3Afor%3Alawyer)
- Revisão de base legal de Fiscais existentes; novas hipóteses de detecção (Lei 14.133, 13.019, 9.504, 8.112, STF SV 13).
- Toda nova lógica de detecção exige base legal + exemplo positivo + exemplo negativo. Regra documentada em [`docs/fiscais/GOVERNANCA.md`](docs/fiscais/GOVERNANCA.md).

### 💰 Apoio financeiro
[Catarse Recorrente](https://www.catarse.me/fiscaldigitalbr) (R$ 5–500/mês) ou [GitHub Sponsors](https://github.com/sponsors/fiscal-digital). 100% via MEI, custos publicados em [/transparencia/custos](https://fiscaldigital.org/transparencia/custos).

---

## Onde NÃO precisamos de ajuda agora

Para evitar PRs especulativos que ficarão parados:

- **Novos canais de publicação** (Telegram, Bluesky, Mastodon) enquanto Reddit e X estão bloqueados externamente. O foco é o site.
- **Refactor de arquitetura** sem incidente real motivando. A engine é jovem e o pipeline está estável; mudanças grandes precisam de issue + alinhamento antes.
- **Migração de stack** (TS → Rust, Lambda → ECS, DynamoDB → Postgres etc). Decisões de stack são bound by 12-Factor + AWS WA; abrir RFC antes.
- **Tradução para outros idiomas além de PT/EN** no momento. EN existe para alcance internacional; outros idiomas dependem de demanda real concreta.

Discordou? Abra Issue. A regra é: **discussão pública antes de código**.

---

## Princípios inegociáveis

Antes de propor qualquer mudança, confira se respeita:

1. **Sempre citar a fonte** — todo achado aponta para o diário original no Querido Diário
2. **Não acusar, informar** — linguagem factual, nunca acusatória
3. **Transparência do algoritmo** — cada alerta explica por que foi gerado
4. **Verificabilidade pública** — qualquer cidadão pode checar
5. **Retratação pública** — erro publicado é corrigido no mesmo canal e alcance

Detalhes em [CLAUDE.md](CLAUDE.md).

---

## Posicionamento no ecossistema

```
Serenata de Amor  → Federal   (deputados/senadores — CEAP)
Querido Diário    → Municipal (infraestrutura de dados abertos)
Fiscal Digital    → Municipal (inteligência + alertas sobre dados do QD)
```

Fiscal Digital **estende** o ecossistema OKFN — não compete. Todo achado linka para o Querido Diário; nunca replicamos o dado.

---

> Última atualização do roadmap: 2026-05-16. Mudanças significativas viram release notes públicas com tag SemVer. Bugs e features operacionais ficam nas [Issues](https://github.com/fiscal-digital/fiscal-digital/issues).
