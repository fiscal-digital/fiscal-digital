# Campanha Catarse Recorrente — Fiscal Digital

> Texto pronto para colar no formulário de submissão do Catarse.
> Modelo: campanha recorrente (mensalidade), não de meta única.
> Inspiração: [catarse.me/queridodiario-okbr](https://www.catarse.me/queridodiario-okbr)

---

## Título da campanha

**Fiscal Digital — Fiscalização autônoma de gastos públicos municipais**

## Slug sugerido

`fiscaldigital`

## Categoria

Jornalismo / Causas Sociais / Tecnologia

## Imagem de capa (briefing visual)

- Fundo: paleta da marca (`fiscal-digital-web/brand/colors.json`)
- Tagline: "Fiscalização autônoma de gastos públicos"
- Visual: mapa do Brasil com 50 cidades destacadas em pontos luminosos

## Pitch curto (1 parágrafo)

Fiscal Digital é um agente autônomo que lê diários oficiais de **50 cidades brasileiras** todos os dias, identifica padrões suspeitos em contratos, licitações e nomeações, e publica alertas factuais com fonte citada. Tudo open source. Toda receita pública. Cada centavo arrecadado vira linha em [fiscaldigital.org/transparencia](https://fiscaldigital.org/transparencia).

## Sobre o projeto (texto completo da página)

### O que é

5.570 municípios brasileiros publicam atos administrativos em diários oficiais todos os dias. O conteúdo é público — mas ninguém lê. PDFs longos, sem busca, sem alerta. Fracionamento de contrato, fornecedores fantasmas e aditivos abusivos passam despercebidos até virarem auditoria do TCE, anos depois.

Fiscal Digital muda isso.

É um agente autônomo de IA que lê diários oficiais municipais 24 horas por dia, identifica padrões de risco com base na **Lei 14.133/2021** (Nova Lei de Licitações), gera alertas factuais com fonte citada e publica em canais públicos abertos: RSS, Reddit, X.

### Como funciona

5 Fiscais especializados rodam em paralelo:

- **Fiscal de Licitações** — fracionamento, dispensas indevidas
- **Fiscal de Contratos** — aditivos acima de 25%, prorrogações excessivas
- **Fiscal de Fornecedores** — CNPJ jovem, concentração por secretaria
- **Fiscal de Pessoal** — pico de nomeações em períodos eleitorais
- **Fiscal Geral** — orquestra e consolida o risco

Cada alerta cita a lei que justifica o flag e o link do documento original no [Querido Diário](https://queridodiario.ok.org.br) — projeto da Open Knowledge Brasil que digitaliza diários oficiais. Sem o Querido Diário, o Fiscal Digital não existiria.

### Por que recorrente

Custos do Fiscal Digital são mensais (servidores AWS, modelos de IA Bedrock). Apoio recorrente paga a operação contínua e libera energia para escalar de 50 para 200 cidades.

### Para onde vai o dinheiro

Tudo público em [fiscaldigital.org/transparencia](https://fiscaldigital.org/transparencia). Atualizado mensalmente.

| Item | Custo mensal estimado |
|---|---|
| AWS (Lambda, DynamoDB, SQS, S3) | R$ 80–120 |
| Bedrock (Nova Lite + Claude Haiku 4.5) | R$ 50–100 |
| Domínio + certificados | R$ 5 |
| Catarse + gateway de pagamento (taxa) | ~13% |
| Reserva técnica (auditoria, retratação, jurídico) | variável |

### Princípios não-negociáveis

1. **Sempre citar a fonte** — todo achado linka para o diário original
2. **Não acusar, informar** — linguagem factual, nunca acusatória
3. **Transparência do algoritmo** — cada alerta explica por que foi gerado
4. **Verificabilidade pública** — qualquer cidadão pode checar
5. **Retratação pública** — erro publicado vira correção no mesmo canal e alcance

### Open source

- Código: [github.com/fiscal-digital](https://github.com/fiscal-digital) — licença MIT
- Alertas e dados publicados: licença CC-BY 4.0
- Inspirado em [Serenata de Amor](https://serenata.ai) (federal) e estende [Querido Diário](https://queridodiario.ok.org.br) (municipal)

---

## Tiers de apoio (mesma escada do Querido Diário)

### R$ 5/mês — Apoiador

> "Estou junto."

- Nome (ou "anônimo") na página de transparência
- Acesso à newsletter mensal "Fiscal Digital em números"

### R$ 25/mês — Guardião

Tudo do Apoiador, mais:
- Voto na escolha da próxima cidade a entrar na cobertura (entre as candidatas)
- Acesso antecipado a achados antes da publicação pública (24h)
- Agradecimento nominal nos posts trimestrais de balanço

### R$ 100/mês — Patrono

Tudo do Guardião, mais:
- Nome em destaque na página de transparência
- Reunião trimestral aberta com a equipe (Q&A 1h)
- Influência direta na priorização do roadmap (1 voto adicional por trimestre)

### R$ 500/mês — Instituição / Redação

Tudo do Patrono, mais:
- Logo na página `/transparencia` (com aprovação curatorial — sem conflito de interesse)
- Acesso à API premium em `api.fiscaldigital.org` (após Sprint 5)
- Webhook por cidade — alerta em tempo real
- Reunião mensal com a equipe

---

## Recompensas pontuais (one-shot, opcional)

- R$ 50 — Adesivo "Fiscal Digital" + camiseta digital (avatar para redes)
- R$ 200 — Pacote impresso (camiseta física + adesivos)

---

## FAQ

**Quem está por trás?**
Diego Moreira Vieira — engenheiro de software. Operação atual via MEI; OSC formal será aberta quando o volume justificar.

**Por que Catarse e não doação direta?**
Mesmo modelo do Querido Diário. Plataforma de financiamento coletivo dá legitimidade fiscal e reforça o ecossistema OKFN. Taxa total ~13% é o custo aceito.

**O dinheiro vai para o bolso de alguém?**
Não. 100% vira infra (AWS + Bedrock), revisão jurídica part-time e reserva técnica. Tudo na página `/transparencia`.

**E se vocês publicarem um alerta errado?**
Política de retratação: erro vira correção no mesmo canal e alcance. Issue público no GitHub com label `falso-positivo`. Auditável.

**Posso doar uma vez só sem ser recorrente?**
Hoje a campanha é recorrente (mesmo modelo do QD). Para apoio pontual, há `apoia.se/fiscaldigital` (em montagem).

---

## Submissão — checklist Diego

- [ ] Criar conta no Catarse com e-mail diego@fiscaldigital.org (ou pessoal)
- [ ] Validar CPF + dados bancários (conta corrente já existente, MEI)
- [ ] Subir imagem de capa (briefing acima)
- [ ] Colar texto deste arquivo na descrição
- [ ] Configurar tiers conforme acima
- [ ] Submeter para curadoria (1–3 semanas de espera)
- [ ] Em paralelo: criar perfil-espelho no Apoia.se como backup
