# Guia de Contribuição — Fiscal Digital

Obrigado pelo interesse em contribuir.

📍 **Comece pelo [ROADMAP.md](ROADMAP.md)** — visão estratégica do projeto, o que está em curso e onde precisamos de ajuda hoje.

---

## Antes de começar

1. Leia o [Código de Conduta](CODE_OF_CONDUCT.md)
2. Leia o [ROADMAP.md](ROADMAP.md) — entenda onde o projeto está indo
3. Abra uma **Issue antes de codar** — toda mudança começa com discussão pública
4. Para mudanças em lógica de Fiscal: leia o [CLAUDE.md](CLAUDE.md) e [`docs/fiscais/GOVERNANCA.md`](docs/fiscais/GOVERNANCA.md)

---

## Como navegar o backlog público

Filtre as [Issues](https://github.com/fiscal-digital/fiscal-digital/issues) pelas labels abaixo para encontrar algo do seu perfil.

### Por perfil

| Label | Para quem |
|---|---|
| [`for:dev`](https://github.com/fiscal-digital/fiscal-digital/labels/for%3Adev) | Devs (TypeScript, AWS, Next.js) |
| [`for:citizen`](https://github.com/fiscal-digital/fiscal-digital/labels/for%3Acitizen) | Cidadãos e jornalistas (sem código) |
| [`for:lawyer`](https://github.com/fiscal-digital/fiscal-digital/labels/for%3Alawyer) | Especialistas em direito público / contratação |
| [`good first issue`](https://github.com/fiscal-digital/fiscal-digital/labels/good%20first%20issue) | Primeiro PR — onboarding curto |
| [`help wanted`](https://github.com/fiscal-digital/fiscal-digital/labels/help%20wanted) | Itens que precisam de braços externos |

### Por área técnica

| Label | Escopo |
|---|---|
| `area:engine` | TypeScript: Fiscais, Skills, analyzer |
| `area:web` | Next.js — site `fiscaldigital.org` |
| `area:infra` | Terraform, AWS, CI/CD |
| `area:fiscal` | Lógica de detecção de um Fiscal específico |
| `area:dados` | Cobertura de cidades, dataset, integração com fontes |
| `area:docs` | Documentação |

### Por complexidade

| Label | Esforço |
|---|---|
| `complexity:S` | ≤ 2h — bom para primeiro PR |
| `complexity:M` | 2–8h — exige contexto razoável |
| `complexity:L` | 1–3 dias — alinhe via Issue antes de codar |

---

## Tipos de contribuição

### 🛠️ Código (`for:dev`)

Issues com label [`for:dev`](https://github.com/fiscal-digital/fiscal-digital/labels/for%3Adev). Recomendado começar por `complexity:S` + `good first issue`.

**Stack:** TypeScript strict · Node 24 · AWS Lambda + DynamoDB + Bedrock · Terraform · Next.js 16 SSG · Playwright. Detalhes em [CLAUDE.md](CLAUDE.md).

### 🏛️ Adicionar nova cidade (`type:cidade-nova`)

Use o template [`nova-cidade`](.github/ISSUE_TEMPLATE/nova-cidade.md). Inclua:
- Nome do município e código IBGE
- Confirmação de cobertura no [Querido Diário](https://queridodiario.ok.org.br)
- Link para o diário oficial do município

### ⚖️ Criar novo Fiscal (`type:fiscal-novo`)

Use o template [`novo-fiscal`](.github/ISSUE_TEMPLATE/novo-fiscal.md). **Obrigatório**:
- [ ] Referência legal (lei + artigo)
- [ ] Exemplo real de gazette que dispara o alerta
- [ ] Exemplo real que **não** deve disparar (falso positivo evitado)
- [ ] Taxa de falso positivo estimada

Sem isso, não merge. Política existe para preservar credibilidade.

### 🔌 Nova fonte de dados

Use o template [`nova-fonte`](.github/ISSUE_TEMPLATE/nova-fonte.md). Inclua URL, documentação, campos disponíveis e licença.

### 🐛 Bug report

Template [`bug-report`](.github/ISSUE_TEMPLATE/bug-report.md). Inclua passos de reprodução e ambiente.

### 🚨 Falso positivo (`type:false-positive`) — alta prioridade

Template [`falso-positivo`](.github/ISSUE_TEMPLATE/falso-positivo.md). Identificou alerta incorreto publicado? Abra **imediatamente**. Aplicamos a [Política de Retratação](#política-de-retratação).

### 📰 Apoio sem código (`for:citizen`)

Não precisa programar para ajudar:

- **Validar achados** publicados em sua cidade — clique no link do diário oficial, confira o ato, abra issue se algo estiver errado
- **Sugerir cobertura** de cidade que falta no top 50
- **Divulgar** alertas reais para a comunidade local
- **Apoiar financeiramente** via [Catarse](https://www.catarse.me/fiscaldigitalbr) ou [GitHub Sponsors](https://github.com/sponsors/fiscal-digital)

### ⚖️ Revisão jurídica (`for:lawyer`)

Especialistas em direito público / contratação podem revisar a base legal de um Fiscal existente, propor novas hipóteses de detecção ou ajustar filtros. Comece pelas issues `type:legal-review`.

---

## Fluxo de desenvolvimento

```
1. Abra Issue → discussão pública
2. Aguarde alinhamento de um maintainer (especialmente complexity:L)
3. Fork do repositório
4. Crie branch: feat/fiscal-obras, fix/cnpj-validator, docs/roadmap-update, etc.
5. Implemente com testes
6. Abra PR com o checklist preenchido
7. Aguarde review de ao menos 1 maintainer
8. Merge com squash
```

---

## Checklist de PR

Todo PR deve preencher o checklist em [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).

**Para mudanças em lógica de Fiscal — obrigatório:**
- [ ] Referência legal incluída
- [ ] Exemplo que dispara o alerta
- [ ] Exemplo que NÃO deve disparar
- [ ] Testes passando
- [ ] PR-gate `Terraform Plan + Lint + Test` verde

**Para mudanças em UI:**
- [ ] Teste E2E correspondente em `fiscal-digital-web/e2e/*.spec.ts` quando ≥ M (1-3h)

---

## Política de Retratação

Se um alerta publicado for demonstrado incorreto:

1. Abrimos issue pública com label `type:false-positive`
2. Removemos o conteúdo do dashboard
3. Publicamos correção nas mesmas redes com o mesmo alcance do alerta original
4. Documentamos o que falhou no modelo para prevenir recorrência

A credibilidade do projeto depende dessa transparência. Esta política não é negociável.

---

## Princípios inegociáveis

Antes de propor qualquer mudança, confira se respeita os 5 princípios do projeto:

1. **Sempre citar a fonte** — todo achado aponta para o diário oficial
2. **Não acusar, informar** — linguagem factual, nunca acusatória
3. **Transparência do algoritmo** — cada alerta explica por que foi gerado
4. **Verificabilidade pública** — qualquer cidadão pode checar
5. **Retratação pública** — erro publicado é corrigido no mesmo canal

Detalhes em [CLAUDE.md](CLAUDE.md).

---

## Contato

- **Issues:** bugs, features, novos Fiscais, novas cidades, propostas abertas — [github.com/fiscal-digital/fiscal-digital/issues](https://github.com/fiscal-digital/fiscal-digital/issues)
- **Email:** lineu@fiscaldigital.org
