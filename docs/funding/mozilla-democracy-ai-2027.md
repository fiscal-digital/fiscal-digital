# Mozilla Foundation — Democracy × AI Cohort (Draft for 2027 cycle)

> The 2026 cycle closed on **March 16, 2026**. This document is the dossier for the **2027 cycle** (expected deadline: March 2027). All copy in English (Mozilla requirement).
>
> Program: https://www.mozillafoundation.org/en/what-we-do/grantmaking/incubator/democracy-ai-cohort/
> Funding: US$ 50k (Tier I, 12 months) → US$ 250k (Tier II) — total possible US$ 300k

## Eligibility check (2026 criteria, expected to carry over)

- [x] Brazil is among eligible countries
- [x] Working technology people can actually use (12 findings live, 8.4k gazettes processed)
- [x] Open source code (MIT) or clear roadmap to open source — already 100% open
- [x] Committed team able to execute over 12 months
- [ ] Application must be in English — this dossier is the source
- [ ] Must legally receive funds from a U.S. 501(c)(3) — **action item**: identify fiscal sponsor (e.g., Open Source Collective) before submission

**Key gap to close:** fiscal-sponsor relationship. Open Source Collective (501(c)(6)) is the natural choice — it lets us receive grant funds without incorporating a Brazilian OSC.

## Category fit

Mozilla's three categories — Fiscal Digital fits primarily **Institutional Transparency and Accountability** (the second category). Strong cross-cutting fit with **Information Ecosystem Resilience** (we feed local journalism with verifiable findings).

## Application narrative (drafted)

### Project name
Fiscal Digital — Autonomous Oversight of Brazilian Municipal Public Spending

### One-line description
An open-source AI agent that reads Brazilian municipal official gazettes 24/7, identifies risk patterns in public-money flows, and publishes factual, source-cited alerts on public channels.

### The problem (300 words target)

Brazil has 5,570 municipalities. Each publishes its administrative acts — contracts, procurements, appointments, payments — in an official gazette. The content is legally public, but practically unreadable: long unsearchable PDFs published daily, scattered across thousands of municipal websites.

Civil-society oversight of municipal spending depends on one of three actors: investigative journalists, state audit courts (TCEs), and the Federal Public Ministry. All three are structurally underfunded relative to the surface area they cover. Local newsrooms have collapsed across most Brazilian states; the average TCE audits municipalities on a 2- to 4-year cycle. By the time irregularities surface, the political incentives to hide them have already played out.

The result: contract splitting (`fracionamento`), shell suppliers, abusive contract amendments, electorally-timed appointment spikes — all forms of low-grade corruption that are visible in the gazettes from day one — go undetected for years.

The data is open. The bottleneck is reading volume.

### Our approach

Fiscal Digital is an autonomous AI agent built on five specialized "Fiscals" — each an independent agent with domain knowledge in a specific risk pattern from the new Brazilian Procurement Law (Law 14.133/2021):

- Procurement Fiscal — contract splitting, unjustified waivers (Art. 75)
- Contract Fiscal — amendments above 25% of original value (Art. 125)
- Supplier Fiscal — under-6-month CNPJ, secretariat-level concentration above 40%
- Personnel Fiscal — appointment spikes during electoral periods
- General Fiscal — orchestrates and consolidates a composite risk score

Each Fiscal uses a layered processing model: regex extraction (free), Amazon Nova Lite via Bedrock for classification (~$0.05 per 1,000 gazettes), and Claude Haiku 4.5 only for the narrative of high-risk findings (riskScore ≥ 60). Cost stays under US$ 30/month at 50-city coverage.

Findings are published on RSS, Reddit, and X with two non-negotiable invariants: every alert links to the original Querido Diário gazette, and every alert states the legal article it flagged.

### Why now

Brazil's new Procurement Law (14.133/2021) became mandatory in 2024, replacing the 1993 framework. Article-level pattern matching is now legally well-defined and stable — exactly the substrate generative AI handles best.

At the same time, **Querido Diário** (Open Knowledge Brazil) has digitized hundreds of municipal gazettes into a normalized API. Without Querido Diário, this project would be a 5-year data-engineering project. With it, the engineering is done — the work is reading.

### Open-source posture

- Code: MIT license, https://github.com/fiscal-digital
- Alerts and data: CC-BY 4.0
- Inspired by Serenata de Amor (federal scope, OKFN Brazil) and extends Querido Diário (municipal scope, OKFN Brazil) — explicit ecosystem positioning, not competition

### What US$ 50,000 would unlock (Tier I budget)

| Line item | 12-month cost (USD) |
|---|---|
| Scale infrastructure from 50 → 200 cities (AWS + Bedrock) | 5,000 |
| Part-time legal review (Brazilian lawyer specializing in administrative law, ~10h/week) | 18,000 |
| Communications + outreach to local journalists | 8,000 |
| Annual independent security audit | 2,500 |
| Documentation + multilingual content (PT/EN) | 4,000 |
| Founder time (part-time, deeply discounted) | 12,500 |
| **Total** | **50,000** |

### Tier II milestones (the case for US$ 250k)

- 200 → 500 cities covered (federalize across all Brazilian state capitals + top 500 by population)
- Public REST API (`api.fiscaldigital.org`) with freemium tier for newsrooms
- Open-data partnership with at least 3 state audit courts (TCEs)
- Integration with TSE campaign-finance dataset to cross-check campaign donors against municipal suppliers
- Replicate the model for one Latin American peer country (Argentina or Mexico) as proof of generalization

### Team and governance

Solo-founder operation today (Diego Moreira Vieira, software engineer). Tier I budget includes part-time legal review as the first paid role. Tier II would add communications and a second engineer.

Decision-making is transparent: roadmap in public GitHub project board, every code change reviewed in public PRs, every alert auditable end-to-end (gazette → extraction → classification → narrative → publication).

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| False positive damages a local supplier | Public retraction policy on the same channel and reach; legal review pre-publication for findings above riskScore 80 |
| Political retaliation against the project | Open-source code is replicable; no single point of failure |
| LLM hallucinations | Layered model: regex floor + classification ceiling + narrative only for high-risk; every claim links to the gazette excerpt |
| Funding sustainability | Multi-source: Catarse Recorrente (community), grants (foundations), API premium tier (newsrooms). Detailed in funding ledger at fiscaldigital.org/transparencia |

### Track record (as of submission)

To be updated quarterly. Current state (May 2026):
- 50 cities active, 22 states covered
- 8,400+ gazettes processed end-to-end
- 12+ findings published with full source citation
- 129 passing unit tests across engine + analyzer + publisher
- Operating cost under US$ 30/month
- Production runtime since April 2026

## Submission checklist (T-30 days before deadline)

- [ ] Confirm 2027 program is open and dates announced
- [ ] Identify and confirm fiscal sponsor (Open Source Collective is the leading option)
- [ ] Update metrics block with current quarter numbers
- [ ] Record 60-second project video (English, with EN subtitles)
- [ ] Draft a one-line letter of support from Open Knowledge Brazil (warm intro via Querido Diário team)
- [ ] Draft one-line letter of support from a partnering local newsroom
- [ ] Final read-through by a native English speaker
- [ ] Submit before deadline

## Sources

- [Mozilla Democracy x AI Cohort 2026 — program page](https://www.mozillafoundation.org/en/what-we-do/grantmaking/incubator/democracy-ai-cohort/)
- [2026 cycle deadline (closed March 16, 2026)](https://grantedai.com/blog/mozilla-democracy-ai-cohort-50k-grants-2026)
- [Tier II details ($300k total possible)](https://oyaop.com/opportunity/competitions-and-awards/mozilla-democracy-ai-incubator-2026-grants-up-to-300000-for-global-innovators/)
