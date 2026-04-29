# Fiscal Digital — Diretrizes do Projeto

## Identidade de Marca

| Contexto | Formato |
|---|---|
| Marca / Site | Fiscal Digital *(duas palavras)* |
| Domínio | fiscaldigital.org |
| Repositórios | `fiscal-digital-*` |
| AWS recursos | `fiscal-digital-*-prod` |
| X (institucional) | `@FiscalDigitalBR` |
| X (bot Lineu) | `@LiFiscalDigital` |
| GitHub Org | `fiscal-digital` |
| GitHub bot user | `lineu-do-fiscal-digital` |

---

## Missão

Agente autônomo de fiscalização de gastos públicos municipais no Brasil.
Transforma dados públicos em alertas verificáveis para a sociedade.
Primeira cobertura: Caxias do Sul (RS) — gestão Adiló Didomenico (2021–atual).

## Inspiração e Ecossistema

Fiscal Digital nasce sobre os ombros de dois projetos fundamentais
da inovação cívica brasileira:

**[Serenata de Amor](https://serenata.ai) — OKFN Brasil**
Pioneira no uso de IA para fiscalizar gastos públicos no Brasil.
Monitora reembolsos do CEAP (deputados e senadores federais) desde 2016.
Nossa abordagem de agentes fiscais é diretamente inspirada pela Rosie.

**[Querido Diário](https://queridodiario.ok.org.br) — OKFN Brasil**
Infraestrutura que digitalizou os diários oficiais de centenas de
municípios brasileiros. É nossa principal fonte de dados.
Sem o Querido Diário, o Fiscal Digital não existiria.

### Posicionamento no ecossistema

```
Serenata de Amor  → Federal   (deputados/senadores — CEAP)
Querido Diário    → Municipal (infraestrutura de dados abertos)
Fiscal Digital    → Municipal (inteligência + alertas sobre dados do QD)
```

Fiscal Digital não compete — estende o ecossistema.
Todo achado linka para o Querido Diário. Nunca replicamos o dado.

## Princípios Inegociáveis

- **Sempre citar a fonte** — todo achado aponta para o diário original
- **Não acusar, informar** — linguagem factual, nunca acusatória
- **Transparência do algoritmo** — cada alerta explica por que foi gerado
- **Verificabilidade pública** — qualquer cidadão pode checar a fonte
- **Retratação pública** — erro publicado = correção no mesmo canal e alcance

---

## Mapa de Repositórios

| Repo | Conteúdo | Deploy |
|---|---|---|
| `fiscal-digital` | Engine (Fiscais + Skills + API) + Terraform | AWS Lambda via GH Actions |
| `fiscal-digital-web` | Next.js — landing + dashboards por cidade | S3 + CloudFront via GH Actions |
| `fiscal-digital-collectors` | Adaptadores de fontes de dados | Lambda agendado via GH Actions |
| `fiscal-digital-analytics` | Notebooks, relatórios, exports CSV | Manual / GitHub Pages |

---

## Domínio e DNS

- **Registrador:** GoDaddy
- **DNS:** AWS Route 53 (`us-east-1`)
- **Hosted Zone:** fiscaldigital.org

### Subdomínios

```
fiscaldigital.org                              → landing institucional
www.fiscaldigital.org                          → redirect para raiz
api.fiscaldigital.org                          → API pública REST
caxias.fiscaldigital.org                       → painel gestão Adiló
porto-alegre.fiscaldigital.org                 → painel Porto Alegre (Fase 2)
{cidade}.fiscaldigital.org/alertas             → feed de achados
{cidade}.fiscaldigital.org/fornecedores/{cnpj} → perfil de fornecedor
{cidade}.fiscaldigital.org/secretarias/{id}    → painel por secretaria
```

---

## Cidades Cobertas

| Fase | Cidade | IBGE | Gazettes QD | Status |
|---|---|---|---|---|
| **MVP (Fase 1)** | Caxias do Sul | 4305108 | 5.861 | Ativo |
| **Fase 2** | Porto Alegre | 4314902 | 10.000+ | Planejado |
| Futuro | Canoas | 4304606 | 0 | Aguarda cobertura QD |
| Futuro | Passo Fundo | 4314100 | 0 | Aguarda cobertura QD |

Backfill Fase 1: 01/01/2021 → hoje (gestão Adiló completa).

---

## Regras de Ouro (mandatórias)

- **Arquitetura:** 100% Serverless AWS (Lambda, API Gateway, SQS, DynamoDB)
- **Linguagem:** TypeScript Strict Mode
- **Runtime:** Node.js 22.x (`nodejs22.x` nas Lambdas — provider AWS ainda não suporta 24.x)
- **Infraestrutura:** Terraform com estado remoto
- **Segurança:** OIDC — `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` proibidos
- **Commits:** sem `Co-Authored-By: Claude` — créditos apenas para contribuidores humanos
- **Commits:** sempre commitar TODOS os arquivos — nunca commit parcial
- **Terraform:** commitar `.tf` antes de aplicar — CI destrói o que não está no código
- **KMS alias:** `alias/fiscal-digital-kms-prod`
- **Alertas:** confidence >= 0.70 + riskScore >= 60 para publicar
- **Linguagem dos alertas:** factual — "identificamos", "o documento aponta" — nunca acusatório

## Convenção de Nomenclatura AWS

`kebab-case` minúsculas em todos os recursos.

```
fiscal-digital-collector-prod
fiscal-digital-analyzer-prod
fiscal-digital-publisher-prod
fiscal-digital-api-prod
fiscal-digital-alerts-prod      (DynamoDB)
fiscal-digital-gazettes-prod    (DynamoDB)
fiscal-digital-suppliers-prod   (DynamoDB)
fiscal-digital-queue-prod       (SQS)
fiscal-digital-kms-prod         (KMS)
```

---

## Arquitetura: Fiscais como Agentes

Cada Fiscal é um agente autônomo com domínio específico,
Skills próprias e memória persistente no DynamoDB.
O Fiscal Geral orquestra os demais.

```
Fiscal Geral (orquestrador)
  ├── Fiscal de Licitações
  ├── Fiscal de Contratos
  ├── Fiscal de Fornecedores
  └── Fiscal de Pessoal
```

### Contrato de Skill (TypeScript)

```typescript
interface Skill {
  name: string
  description: string         // visível ao agente ao decidir usar
  execute(input: unknown): Promise<SkillResult>
}

interface SkillResult {
  data: unknown
  source: string              // URL do Querido Diário — OBRIGATÓRIO
  confidence: number          // 0.0 a 1.0
}

interface Finding {
  fiscalId: string            // qual fiscal gerou
  cityId: string              // territory_id IBGE
  type: string                // fracionamento | cnpj_jovem | aditivo_abusivo | ...
  riskScore: number           // 0–100
  evidence: Evidence[]        // trechos + URLs das gazettes
  narrative: string           // texto legível gerado por LLM
  legalBasis: string          // artigo de lei que justifica a flag
  publishedAt?: string        // ISO8601 se já publicado
}
```

### Skills Compartilhadas

| Skill | Descrição |
|---|---|
| `query_diario` | Busca gazettes na API do Querido Diário |
| `extract_entities` | Haiku extrai CNPJ, valor, secretaria, tipo do ato |
| `lookup_memory` | Consulta histórico no DynamoDB |
| `save_memory` | Salva entidade/achado no DynamoDB |
| `score_risk` | Calcula risco composto (0–100) |
| `generate_narrative` | Haiku gera texto com fonte citada (riskScore >= 60) |
| `validate_cnpj` | Valida CNPJ na Receita Federal |
| `check_sanctions` | Verifica empresa no CEIS/CNEP (CGU) |

### Fiscais MVP (Fase 1)

**Fiscal de Licitações**
Detecta: dispensas, fracionamento de contrato, inexigibilidades sem justificativa
Base legal: Lei 14.133/2021, Art. 75 (teto R$ 100k obras / R$ 50k serviços)

**Fiscal de Contratos**
Detecta: aditivos > 25% do valor original, prorrogações excessivas
Base legal: Lei 14.133/2021, Art. 125

**Fiscal de Fornecedores**
Detecta: CNPJ com < 6 meses na data do contrato, concentração > 40% por secretaria
Fonte: Receita Federal CNPJ API + histórico DynamoDB

**Fiscal de Pessoal**
Detecta: pico de nomeações em períodos eleitorais, rotatividade anormal
Fonte: gazettes com `nomeação`, `exoneração`, `cargo comissionado`

---

## LLM — Extração e Análise

```
Modelo:    Claude Haiku 4.5 (claude-haiku-4-5-20251001)
Conta:     Anthropic pessoal do Diego
Secret:    fiscaldigital-anthropic-prod → campo: api_key
Estratégia: prompt caching no system prompt dos Fiscais
```

### Arquitetura de processamento em 3 camadas

```
Camada 1 — Regex (grátis)
  → CNPJ, valores (R$), datas, números de contrato

Camada 2 — Claude Haiku 4.5 com cache (extração e classificação)
  → tipo de ato, secretaria, fornecedor, contexto legal
  → system prompt com regras fiscais em cache

Camada 3 — Claude Haiku 4.5 (narrativa — apenas riskScore >= 60)
  → texto legível com fonte citada, pronto para publicação
```

---

## Fontes de Dados

### Fase 1 — MVP

| Fonte | Dados | Acesso |
|---|---|---|
| Querido Diário API | Diários oficiais municipais | Pública, gratuita |
| Receita Federal | CNPJ: situação, sócios, data abertura | Pública, gratuita |
| CGU — CEIS/CNEP | Empresas suspensas e multadas | dados.gov.br (CSV) |

### Fase 2

| Fonte | Dados |
|---|---|
| TSE — Doações de campanha | Cruzar financiadores com fornecedores |
| TCE-RS | Auditorias e irregularidades |
| Portal Transparência Federal | Repasses federais ao município |

---

## Ciclo Autônomo (produção)

```
00:00  EventBridge → fiscal-digital-collector-prod
00:10  Coleta novas gazettes (Querido Diário API)
00:20  Regex: CNPJ, valores, datas (Camada 1)
00:25  Haiku classifica atos (Camada 2, com cache)
00:40  Fiscais rodam análises e cruzamentos no DynamoDB
00:50  Fiscal Geral consolida riskScore
00:55  riskScore >= 60 → SQS fiscal-digital-queue-prod
01:00  fiscal-digital-publisher-prod → X + Reddit + DynamoDB
```

---

## Formato de Alerta Publicado

```
🔍 [TIPO] — [Cidade]

[Descrição factual do achado — 2 a 3 linhas]

📋 [Número do ato / contrato]
💰 Valor: R$ [X]
🏢 Fornecedor: [NOME] (CNPJ: XX.XXX.XXX/XXXX-XX)
🏛️ Secretaria: [SIGLA]
📅 Data: DD/MM/YYYY

⚠️ [Razão objetiva do alerta]
⚖️ Base legal: [Lei X, Art. Y]

🔗 Fonte: [URL Querido Diário]
#FiscalDigital #[Cidade] #TransparênciaPublica
```

Publicação automática: riskScore >= 60 e confidence >= 0.70.

---

## Segurança

- IAM least-privilege por Lambda (definido no Terraform)
- Billing alert Anthropic: $10 threshold
- AWS Budget: $10 alerta / $20 bloqueio
- DLQ (Dead Letter Queue) para alertas com falha na publicação
- SQS rate limiting: 60 req/min (Querido Diário)
- Lambda timeout máximo: 5 minutos
- Cold start aceito na API Lambda (MVP — sem provisioned concurrency)

---

## Governança Open Source

### Licenças

Seguimos o padrão do Querido Diário (OKFN Brasil):

| Repo | Licença |
|---|---|
| `fiscal-digital` | MIT |
| `fiscal-digital-collectors` | MIT |
| `fiscal-digital-web` | MIT |
| `fiscal-digital-analytics` | CC-BY 4.0 |
| Alertas e dados publicados | CC-BY 4.0 |

### Modelo de contribuição

```
Issue → discussão pública → fork → PR → review → merge
```

PR com mudança em lógica de Fiscal exige:
1. Referência legal (lei + artigo)
2. Exemplo de gazette que dispara o alerta
3. Exemplo que NÃO deve disparar (falso positivo evitado)

### Política de retratação

Alerta incorreto → issue público `falso-positivo` → correção publicada
nas mesmas redes com o mesmo alcance do alerta original.

---

## Secrets de Produção

| Secret | Campos |
|---|---|
| `fiscaldigital-anthropic-prod` | `api_key` |
| `fiscaldigital-x-prod` | `api_key`, `api_secret`, `access_token`, `access_token_secret` (bot: @LiFiscalDigital) |
| `fiscaldigital-reddit-prod` | `client_id`, `client_secret`, `username`, `password` (bot: Lineu) |

Padrão de leitura:
```bash
aws secretsmanager get-secret-value --secret-id <ARN> --query SecretString --output text
```

---

## GitHub Actions

- PR → `terraform plan` + lint + testes
- Push `main` → `terraform apply` + deploy Lambdas
- Workflows: `id-token: write` + `role-to-assume: ${{ vars.AWS_ROLE_ARN }}`
- Proibido: `AWS_ACCESS_KEY_ID` em qualquer workflow

## Execução Autônoma

Claude tem acesso total às credenciais AWS — executar via Bash diretamente,
nunca pedir ao Diego para rodar comandos. Inclui: AWS CLI, Terraform,
bundle/deploy de Lambdas, leitura de Secrets Manager.

## Learning System (Self-Improving Agent)

- **Soluções não-óbvias** → `.learnings/LEARNINGS.md`
- **Erros de ferramentas/CI** → `.learnings/ERRORS.md`
- **Capacidades pedidas** → `.learnings/FEATURE_REQUESTS.md`
- **Promoção** → `/learning promote <ID>` move entries high/critical para CLAUDE.md
- **Formato ID:** `LRN-YYYYMMDD-XXX` / `ERR-YYYYMMDD-XXX` / `FEAT-YYYYMMDD-XXX`
