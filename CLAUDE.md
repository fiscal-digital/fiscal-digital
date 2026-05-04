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
Cobertura: top 50 cidades brasileiras por população + capitais (RS como origem
do MVP, gestão Adiló de Caxias do Sul 2021–atual).

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

## Brand Pack — owned by `fiscal-digital-web`

Brand pack vive em [`fiscal-digital-web/brand/`](../fiscal-digital-web/brand/),
não neste repo. **Mudanças no brand requerem PR no repo `fiscal-digital-web`.**
Para guia completo, ler `fiscal-digital-web/CLAUDE.md` + `fiscal-digital-web/brand/README.md`.

### Contrato de consumo da engine

A engine consome ~30% do brand. Sync é **build-time**:

- `engine/scripts/sync-brand.mjs` baixa via `gh api` os 3 arquivos necessários
  (`glossary.json`, `voice-tone.md`, `colors.json`) do repo `fiscal-digital-web`
  antes do TypeScript compile / bundle Lambda.
- Em dev local com `fiscal-digital-web/` clonado vizinho, o script copia
  diretamente do irmão sem `gh api`.
- Arquivos sincronizados ficam em `engine/brand/` (gitignored, gerados em build).

Pontos de consumo dentro da engine:

- **Publisher** valida cada narrativa contra `glossary.json#avoid` antes de
  publicar — qualquer hit rejeita o post (não há override). É mais barato
  regenerar do que retratar.
- **System prompts** de cada Fiscal incluem `voice-tone.md` em prompt caching.
- **Mapeamento `riskScore → cor visual`** segue `colors.json#risk` — único
  source of truth.
- Quando um terceiro consumidor (`-collectors`, `-analytics`) também precisar
  do brand, **migrar para npm package privado** `@fiscal-digital/brand` no
  GitHub Packages.

### Bilíngue (transversal)

Site e brand são **PT-BR (default) + EN**. Site usa roteamento path-based:
`/` é PT, `/en` é EN. Alertas ficam em PT-BR (citam lei brasileira) com
summary EN curto. "Fiscal Digital" é proper noun — não traduzido.

Tagline canônica:
- PT: "Fiscalização autônoma de gastos públicos"
- EN: "Autonomous oversight of Brazilian municipal spending"

### Para sessões Claude trabalhando neste repo (engine + IaC)

Se a tarefa toca em **Fiscal prompts, publisher validation, ou conteúdo
gerado**, conferir as regras na fonte: `../fiscal-digital-web/brand/voice-tone.md`
e `../fiscal-digital-web/brand/glossary.json`. Para qualquer tarefa de visual
ou copy de site, abrir sessão dedicada em `fiscal-digital-web/`.

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

### Subdomínios e rotas

Estratégia atual: **single-domain com rotas por cidade** (não subdomínio por cidade).
Subdomínio por cidade fica para depois — gera complexidade de DNS/cert para 50+
cidades sem ganho real no MVP.

```
fiscaldigital.org                              → landing institucional (PT)
fiscaldigital.org/en                           → landing institucional (EN)
fiscaldigital.org/alertas                      → feed global de achados
fiscaldigital.org/cidades/{slug}               → painel por cidade (futuro)
www.fiscaldigital.org                          → redirect para raiz
api.fiscaldigital.org                          → API pública REST (RSS + JSON)
```

API pública atual (Sprint 5): exposta via Lambda Function URL pública. Migração
para `api.fiscaldigital.org` formal aguarda decisão sobre custódia de cert.

---

## Cidades Cobertas

Fonte de verdade: [`packages/engine/src/cities/index.ts`](packages/engine/src/cities/index.ts).
Adicionar cidade = adicionar entry naquele arquivo.

**Cobertura atual: 50 cidades ativas + 2 planejadas (22 estados).**

- **Origem do MVP:** Caxias do Sul (RS, IBGE 4305108) — gestão Adiló Didomenico
  (2021–atual). Backfill prioritário: 01/01/2021 → hoje.
- **Capitais (todas):** Brasília, São Paulo, Rio de Janeiro, Salvador, Fortaleza,
  Belo Horizonte, Manaus, Curitiba, Recife, Goiânia, Belém, Porto Alegre, Maceió,
  Natal, Campo Grande, João Pessoa, Teresina, São Luís, Aracaju, Cuiabá,
  Florianópolis, Porto Velho.
- **Outras grandes:** Caxias do Sul, Campinas, Guarulhos, São Gonçalo, São Bernardo
  do Campo, Duque de Caxias, Nova Iguaçu, Santo André, Osasco, Sorocaba, Uberlândia,
  Ribeirão Preto, São José dos Campos, Jaboatão dos Guararapes, Contagem, Joinville,
  Feira de Santana, Londrina, Juiz de Fora, Aparecida de Goiânia, Serra, Campos dos
  Goytacazes, Belford Roxo, Niterói, São José do Rio Preto, Ananindeua, Vila Velha,
  Mogi das Cruzes.
- **Planejadas (sem cobertura QD ainda):** Canoas (RS), Passo Fundo (RS).

Cobertura efetiva por cidade depende do Querido Diário ter o município indexado.
Se QD não cobre, o collector pula sem erro.

---

## Cidades-padrão para Provas de Conceito

Ao testar mudanças no engine (novo Fiscal, refactor de cache, migration script, etc.),
**sempre rodar primeiro contra Caxias do Sul + Porto Alegre** antes de aplicar
ao top 50.

Razão:
- **Caxias do Sul** (4305108): origem do MVP, gestão Adiló completa 2021→hoje,
  3.289 gazettes / 13.707 excerpts. Cobertura denso e diversa.
- **Porto Alegre** (4314902): capital, escala média (1.206 gazettes), perfil
  diferente do interior — valida generalização.

As duas juntas cobrem ~10% do volume total mas representam padrões suficientes
para validar comportamento. Custo de PoC: ~$0.90 vs ~$9 do top 50 completo.

## Smoke Tests em Prod — sempre limpar após uso

Quando enviar mensagens sintéticas para SQS / DynamoDB durante smoke tests:

1. **Marcar com prefixo identificável**: `gazetteId: "smoke-test-*"`, CNPJs sintéticos
2. **Anotar todos os timestamps `createdAt` gerados** durante o smoke test — esses viram parte do `pk` do FINDING# e NÃO contêm "smoke" para filtrar
3. **Apagar IMEDIATAMENTE após validação** — antes de continuar com qualquer outra tarefa
4. **Itens a apagar:**
   - `DISPENSA#smoke-test-*` (intermediate FiscalLicitacoes records)
   - `FINDING#fiscal-licitacoes#*#*#<timestamp do smoke>` — buscar por timestamp
   - Mensagens nas filas SQS com `gazetteId` sintético (`aws sqs purge-queue`)
5. **Validar limpeza via API pública**: `curl <api>/alerts` deve retornar só dados reais

**Pattern confiável (bash, NÃO PowerShell):**
```bash
for pk in "PK1" "PK2" "PK3"; do
  aws dynamodb delete-item --table-name fiscal-digital-alerts-prod --region us-east-1 \
    --key "{\"pk\":{\"S\":\"$pk\"}}"
  echo "deleted: $pk"
done
```

PowerShell com `Out-Null` em loop pode retornar exit 252 silencioso — evitar.

Razão: dados de teste em prod poluem feeds RSS, API pública, métricas. Site/leitores RSS exibem alertas reais — síntéticos confundem usuários e quebram credibilidade.

## Regras de Ouro (mandatórias)

- **Arquitetura:** 100% Serverless AWS (Lambda, API Gateway, SQS, DynamoDB)
- **Linguagem:** TypeScript Strict Mode
- **Runtime:** Node.js 24.x (`nodejs24.x` nas Lambdas — alinhado à depreciação de Node 20 no GitHub Actions em fall/2026)
- **Infraestrutura:** Terraform com estado remoto
- **Segurança:** OIDC — `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` proibidos
- **Commits:** sem `Co-Authored-By: Claude` — créditos apenas para contribuidores humanos
- **Commits:** sempre commitar TODOS os arquivos — nunca commit parcial
- **Terraform:** commitar `.tf` antes de aplicar — CI destrói o que não está no código
- **KMS alias:** `alias/fiscal-digital-kms-prod`
- **Alertas:** confidence >= 0.70 + riskScore >= 60 para publicar
- **Linguagem dos alertas:** factual — "identificamos", "o documento aponta" — nunca acusatório

### Regras de engenharia aprendidas em produção (LRN promoted)

- **DynamoDB GSI keys — nunca `?? null`:** campos que são `hash_key` ou `range_key` de GSI devem ser omitidos quando ausentes, nunca setados para `null`. Usar `...(value && { field: value })`. `null` causa `ValidationException` em prod que passa silenciosamente em unit tests. *(LRN-20260502-019)*

- **AWS quotas — verificar ANTES de propor infra:** antes de qualquer `reserved_concurrent_executions`, throughput DynamoDB ou throttle de API, rodar o check real: `aws lambda get-account-settings`, `aws dynamodb describe-limits`, etc. Contas novas podem ter `ConcurrentExecutions = 10` em vez de 1.000. Propor sem verificar = CI quebra em prod. *(LRN-20260503-020)*

- **Cache engine — LLM-derived vs local-derived:** cache armazena apenas campos derivados de LLM (caros). Campos derivados de regex/parsing local (grátis, determinísticos) são **sempre recomputados** no cache hit — nunca cacheados. Omitir o merge causa `undefined` em campos obrigatórios silenciosamente em prod. Pattern correto: `data: { ...extractAll(text), ...cached.llmEntities }`. *(LRN-20260502-021)*

- **`node -e` com backticks em bash — proibido:** bash interpreta backticks dentro de strings como substituição de comando, corrompendo o output silenciosamente (exit 0 falso positivo). Para scripts Node.js com conteúdo TypeScript/JS: usar `Write` para arquivo temp + `node arquivo.js`, ou PowerShell here-string `@'...'@`. *(LRN-20260503-021)*

- **Lambda env vars — fail-fast obrigatório:** usar `requireEnv(key)` (em `packages/engine/src/env.ts`) em vez de `process.env.KEY!`. O `!` causa crash em runtime sem mensagem clara; `requireEnv` lança na inicialização com nome da variável faltante. *(Sprint 6 / TEC-ENG-001)*

- **CloudFront — NUNCA forward `Host` header:** em qualquer behavior cuja origin seja S3 com OAC sigv4 OU Lambda Function URL. Sintoma varia por origin: S3 retorna **404 NotFound** (mascarado como "asset não existe"); Lambda Function URL retorna **403 AccessDeniedException**. Auditar TODOS os behaviors (default + ordered), não só o default. Em terraform: omitir `headers` em `forwarded_values` ou listar explicitamente sem `Host` (ex: `headers = ["Accept-Encoding"]`). *(LRN-20260503-028, LRN-20260503-034)*

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
Fiscal Geral (orquestrador, cross-gazette via consolidarAsync)
  ├── Fiscal de Licitações       — Lei 14.133/2021 Art. 75
  ├── Fiscal de Contratos        — Lei 14.133/2021 Art. 125 + 107
  ├── Fiscal de Fornecedores     — RFB + CGU (CEIS/CNEP)
  ├── Fiscal de Pessoal          — Lei 9.504/97 (período eleitoral)
  ├── Fiscal de Convênios        — Lei 13.019/2014 (OSCs)
  ├── Fiscal de Nepotismo        — STF Súmula Vinculante 13
  ├── Fiscal de Publicidade      — Lei 9.504/97 Art. 73 VI "b"
  ├── Fiscal de Locação          — Lei 14.133/2021 Art. 74 III
  └── Fiscal de Diárias          — Lei 8.112/90 Art. 58 + BrasilAPI feriados
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

### Fiscais Ativos (10 em produção)

**Fiscal de Licitações**
Detecta: dispensas, fracionamento de contrato, inexigibilidades sem justificativa
Base legal: Lei 14.133/2021, Art. 75 (teto R$ 100k obras / R$ 50k serviços)

**Fiscal de Contratos**
Detecta: aditivos > 25% do valor original (50% para reformas), prorrogações excessivas
Base legal: Lei 14.133/2021, Art. 125 + Art. 107

**Fiscal de Fornecedores**
Detecta: CNPJ < 12 meses na data do contrato, concentração > 40% por secretaria, situação cadastral irregular (RFB), empresa sancionada (CGU CEIS/CNEP)
Fonte: BrasilAPI CNPJ + CGU + histórico DynamoDB

**Fiscal de Pessoal**
Detecta: pico de nomeações em períodos eleitorais (≥ 3 atos por gazette em janela; ≥ 7 fora), rotatividade anormal
Fonte: gazettes com `nomeação`, `exoneração`, `cargo comissionado`

**Fiscal Geral** (orquestrador)
Detecta: `padrao_recorrente` — ≥ 3 findings mesmo CNPJ em 12 meses (cross-gazette via `consolidarAsync` + `queryAlertsByCnpj`)

**Fiscal de Convênios** (entregue 2026-05-02)
Detecta: convênio sem chamamento público, repasses recorrentes a OSC sem renovação formal
Base legal: Lei 13.019/2014 (Marco Regulatório das OSCs)

**Fiscal de Nepotismo** (entregue 2026-05-02, conservador por design)
Detecta: indício de nepotismo por sobrenome incomum coincidente em cargo comissionado (threshold confidence ≥ 0.95)
Base legal: STF Súmula Vinculante 13, CF Art. 37

**Fiscal de Publicidade** (entregue 2026-05-02)
Detecta: contratação publicitária na janela vedada (3 meses antes da eleição até 31/12)
Base legal: Lei 9.504/97 Art. 73 VI "b" + VII

**Fiscal de Locação** (entregue 2026-05-02)
Detecta: locação inexigível citada sem fundamento (TODO: cruzar com IPTU para preço justo)
Base legal: Lei 14.133/2021 Art. 74 III

**Fiscal de Diárias** (entregue 2026-05-02)
Detecta: pagamento em final de semana / feriado sem justificativa, valor > limite (R$ 800)
Fonte: BrasilAPI feriados nacionais (com cache em memória)
Base legal: Lei 8.112/90 Art. 58

### Agentes operacionais (não fiscalizam município — fiscalizam o projeto)

Categoria distinta dos 10 Fiscais. Estes agentes existem para sustentar o
princípio de **verificabilidade pública aplicada também ao próprio Fiscal
Digital** — não para detectar irregularidade municipal.

**FiscalCustos** (entregue 2026-05-03 — UH-OPS-001)
Lambda agendada (`fiscal-digital-costs-prod`, `cron(0 6 * * ? *)` UTC = 03:00 BRT)
consulta `ce:GetCostAndUsage` com granularidade diária por serviço, converte
USD→BRL via PTAX BCB SGS série 1 e persiste em `fiscal-digital-costs-prod`
(DDB single-key — `COST#DAILY#{date}` / `COST#MONTHLY#{month}` / `COST#FX#{date}`).
Endpoint público `GET /transparencia/costs?days=30` lê do DDB (não chama CE no
request path — CE cobra US$ 0.01/call). Site expõe em `/transparencia/custos`
com mtd, projeção linear, breakdown por serviço (donut SVG inline) e variação
diária (sparkline SVG inline). Sinaliza variação amber se mês corrente
desviar > 20% do anterior.

Princípio: o mesmo padrão de verificabilidade que aplicamos a contratos
públicos aplicamos aos nossos próprios custos.

---

## LLM — Extração e Análise

```
Camada 2 (extração):  Amazon Nova Lite  (amazon.nova-lite-v1:0) via AWS Bedrock
Camada 3 (narrativa): Claude Haiku 4.5  (us.anthropic.claude-haiku-4-5-20251001-v1:0) via AWS Bedrock
Credenciais: IAM role da Lambda analyzer (sem API key, sem Secrets Manager)
Estratégia: sem prompt caching (Bedrock ConverseCommand não suporta cache_control)
```

### Arquitetura de processamento em 3 camadas

```
Camada 1 — Regex (grátis)
  → CNPJ, valores (R$), datas, números de contrato

Camada 2 — Nova Lite via Bedrock (extração e classificação)
  → tipo de ato, secretaria, fornecedor, contexto legal
  → ~$0.047 por 1.000 gazettes processadas

Camada 3 — Claude Haiku 4.5 via Bedrock (narrativa — apenas riskScore >= 60)
  → texto legível com fonte citada, pronto para publicação
  → ~$0.77 por 1.000 gazettes com achado publicado
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
00:10  Coleta novas gazettes (Querido Diário API, 60 req/min)
00:20  Regex: CNPJ, valores, datas (Camada 1)
00:25  Nova Lite via Bedrock classifica atos (Camada 2, sem cache)
00:40  Fiscais (5) rodam análises e cruzamentos no DynamoDB
00:50  Fiscal Geral consolida riskScore
00:55  riskScore >= 60 → SQS fiscal-digital-queue-prod
01:00  fiscal-digital-publisher-prod → Reddit (live DRY_RUN) + X (DRY_RUN) + DynamoDB
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

### Arquivos

| Arquivo | Conteúdo | Quando usar |
|---|---|---|
| `.learnings/LEARNINGS-INDEX.md` | **Índice compacto** de todos os LRNs — sempre carregável em contexto (< 200 linhas) | **Ler ANTES** de qualquer tarefa de infra/engine/publisher |
| `.learnings/LEARNINGS.md` | Detalhe completo (buscar por ID) | Ao precisar do contexto completo de um LRN específico |
| `.learnings/ERRORS.md` | Erros de prod, CI quebrado, dados corrompidos | Ao ter erro com impacto real em prod |
| `.learnings/FEATURE_REQUESTS.md` | Capacidades pedidas | Ao identificar gap de capacidade |

### Fluxo obrigatório ao encontrar problema

1. **Resolver** o problema
2. **Registrar** em `ERRORS.md` (se prod/CI) ou `LEARNINGS.md` (se insight)
3. **Adicionar 1 linha** em `LEARNINGS-INDEX.md` na seção correta
4. **Promover** via `/learning promote <ID>` se prioridade high/critical

### IDs
- `LRN-YYYYMMDD-XXX` — learnings e insights
- `ERR-YYYYMMDD-XXX` — erros de produção
- `FEAT-YYYYMMDD-XXX` — feature requests

### Regra de recall
Antes de iniciar qualquer item com área `IAC`, `ENG`, `PUB` ou `DAT`: consultar o índice (`.learnings/LEARNINGS-INDEX.md`) para verificar learnings relevantes. Evita repetir erros documentados.
