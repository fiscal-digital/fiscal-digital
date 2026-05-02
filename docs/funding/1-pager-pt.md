# Fiscal Digital — 1-pager (PT-BR)

**Fiscalização autônoma de gastos públicos municipais no Brasil.**

## O problema

5.570 municípios brasileiros publicam seus atos administrativos em diários oficiais. O conteúdo é público, mas ilegível na prática: PDFs longos, sem busca, sem alerta. Irregularidades como **fracionamento de contrato**, **fornecedores fantasmas** e **aditivos abusivos** passam despercebidas até virarem auditoria do TCE — anos depois.

A sociedade civil não tem como vigiar 50+ cidades em tempo real. Jornalismo investigativo local é estrutural na crise.

## A solução

Fiscal Digital é um **agente autônomo de IA** que lê diários oficiais municipais 24/7, identifica padrões de risco (Lei 14.133/2021), gera alertas factuais com fonte citada e publica em canais públicos (RSS, Reddit, X).

5 Fiscais especializados rodam em paralelo:
- **Fiscal de Licitações** — fracionamento, dispensas indevidas (Lei 14.133, Art. 75)
- **Fiscal de Contratos** — aditivos > 25% (Art. 125)
- **Fiscal de Fornecedores** — CNPJ jovem, concentração por secretaria
- **Fiscal de Pessoal** — pico de nomeações em períodos eleitorais
- **Fiscal Geral** — orquestra e consolida riskScore

## Princípios não-negociáveis

1. Sempre citar a fonte (link Querido Diário)
2. Não acusar — informar (linguagem factual)
3. Transparência do algoritmo (cada alerta explica por que foi gerado)
4. Verificabilidade pública (qualquer cidadão checa)
5. Retratação pública (erro = correção no mesmo canal e alcance)

## Métricas (2026-05-02)

| Indicador | Valor |
|---|---|
| Cidades cobertas | 50 ativas + 2 planejadas (22 estados) |
| Gazettes processadas | 8.400+ |
| Achados reais publicados | 12+ |
| Cobertura de testes | 129 testes verdes |
| Custo operacional/mês | < US$ 30 (AWS + Bedrock) |
| Licença | MIT (código) + CC-BY 4.0 (alertas) |

## Posicionamento no ecossistema

```
Serenata de Amor  → Federal   (deputados/senadores — CEAP)
Querido Diário    → Municipal (infraestrutura de dados abertos)
Fiscal Digital    → Municipal (inteligência + alertas sobre dados do QD)
```

Fiscal Digital **não compete** com Querido Diário (OKFN Brasil) — estende. Todo achado linka para o diário original. Nunca replicamos o dado.

## Arquitetura

100% Serverless AWS (Lambda + DynamoDB + SQS + Bedrock). TypeScript Strict Mode. Terraform com OIDC. Custo escala linear com cidades.

```
EventBridge → Collector → SQS → Analyzer → 5 Fiscais → Publisher
                                  ↓
                           DynamoDB (memória)
                                  ↓
                       riskScore ≥ 60 → Reddit + X + RSS
```

LLM: Amazon Nova Lite (extração) + Claude Haiku 4.5 (narrativa) via AWS Bedrock.

## O que estamos pedindo

Capital para escalar de **50 para 200 cidades** e contratar **revisão jurídica humana** dos achados antes da publicação.

| Item | Custo anual |
|---|---|
| Infra AWS + Bedrock (200 cidades) | ~US$ 4.800 |
| Revisão jurídica part-time (2x/semana) | ~US$ 12.000 |
| Comunicação + outreach + retratação | ~US$ 6.000 |
| Auditoria de segurança anual | ~US$ 2.000 |
| **Total** | **~US$ 24.800/ano** |

## Equipe

Diego Moreira Vieira — engenheiro de software, founder. MEI atual; OSC formal será aberta quando justificar custo contábil. Operação totalmente autônoma via agentes Claude (engenharia) + revisão humana de output (publicação).

## Links

- Site: https://fiscaldigital.org
- Código: https://github.com/fiscal-digital
- Alertas: https://fiscaldigital.org/alertas
- Transparência: https://fiscaldigital.org/transparencia
- Apoie: https://catarse.me/fiscaldigital
