# Fiscal Digital — 1-pager (EN)

**Autonomous oversight of Brazilian municipal public spending.**

## The problem

Brazil has 5,570 municipalities, each publishing administrative acts in official gazettes. Content is public, but unreadable in practice: long PDFs, no search, no alerts. Irregularities like **contract splitting**, **shell suppliers**, and **abusive amendments** go unnoticed until they become a state-court audit — years later.

Civil society has no way to oversee 50+ cities in real time. Local investigative journalism is structurally collapsing across Brazil.

## The solution

Fiscal Digital is an **autonomous AI agent** that reads municipal official gazettes 24/7, identifies risk patterns (Brazilian Procurement Law 14.133/2021), generates factual alerts with cited sources, and publishes them on public channels (RSS, Reddit, X).

Five specialized Fiscals run in parallel:
- **Procurement Fiscal** — contract splitting, unjustified waivers
- **Contract Fiscal** — amendments > 25% of original value
- **Supplier Fiscal** — under-6-month CNPJ, secretariat concentration
- **Personnel Fiscal** — appointment spikes during electoral periods
- **General Fiscal** — orchestrates and consolidates risk score

## Non-negotiable principles

1. Always cite the source (Querido Diário URL)
2. Inform, don't accuse (factual language)
3. Algorithmic transparency (every alert explains why it was generated)
4. Public verifiability (any citizen can check)
5. Public retraction (errors corrected on the same channel and reach)

## Metrics (2026-05-02)

| Indicator | Value |
|---|---|
| Cities covered | 50 active + 2 planned (22 states) |
| Gazettes processed | 8,400+ |
| Real findings published | 12+ |
| Test coverage | 129 passing tests |
| Operating cost/month | < US$ 30 (AWS + Bedrock) |
| License | MIT (code) + CC-BY 4.0 (alerts) |

## Positioning in the ecosystem

```
Serenata de Amor  → Federal     (representatives — CEAP)
Querido Diário    → Municipal   (open-data infrastructure)
Fiscal Digital    → Municipal   (intelligence + alerts on QD's data)
```

Fiscal Digital **does not compete** with Querido Diário (OKFN Brazil) — it extends. Every finding links to the original gazette. We never replicate the data.

## Architecture

100% Serverless AWS (Lambda + DynamoDB + SQS + Bedrock). TypeScript Strict Mode. Terraform with OIDC. Cost scales linearly with cities.

```
EventBridge → Collector → SQS → Analyzer → 5 Fiscals → Publisher
                                  ↓
                           DynamoDB (memory)
                                  ↓
                       riskScore ≥ 60 → Reddit + X + RSS
```

LLM stack: Amazon Nova Lite (extraction) + Claude Haiku 4.5 (narrative) via AWS Bedrock.

## What we are asking for

Capital to scale from **50 to 200 cities** and add **human legal review** of findings before publication.

| Line item | Annual cost |
|---|---|
| AWS + Bedrock infrastructure (200 cities) | ~US$ 4,800 |
| Part-time legal review (2x/week) | ~US$ 12,000 |
| Communications + outreach + retractions | ~US$ 6,000 |
| Annual security audit | ~US$ 2,000 |
| **Total** | **~US$ 24,800/year** |

## Team

Diego Moreira Vieira — software engineer, founder. Currently operating under MEI (Brazilian individual-entrepreneur structure); a formal nonprofit will be incorporated when accounting cost is justified. The system runs fully autonomously, with human review of published output.

## Links

- Website: https://fiscaldigital.org
- Source code: https://github.com/fiscal-digital
- Live alerts: https://fiscaldigital.org/alertas
- Public ledger: https://fiscaldigital.org/transparencia
- Support: https://catarse.me/fiscaldigital
