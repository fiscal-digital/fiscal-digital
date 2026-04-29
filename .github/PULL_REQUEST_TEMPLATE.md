## Descrição

<!-- O que este PR faz e por quê — foco no "por quê", não no "o quê" -->

## Tipo de mudança

- [ ] Bug fix
- [ ] Nova cidade
- [ ] Novo Fiscal
- [ ] Nova fonte de dados
- [ ] Melhoria de performance
- [ ] Documentação

---

## Checklist obrigatório

### Todo PR
- [ ] Testes passando (`npm test`)
- [ ] Lint passando (`npm run lint`)
- [ ] Descreve o "por quê" da mudança

### Para novo Fiscal ou mudança em lógica de detecção
- [ ] Referência legal incluída (lei + artigo)
- [ ] Exemplo de gazette real que **dispara** o alerta
- [ ] Exemplo de gazette real que **não deve disparar** (falso positivo evitado)
- [ ] Taxa de falso positivo estimada

### Para nova cidade
- [ ] Código IBGE correto
- [ ] Confirmado que Querido Diário cobre o município
- [ ] Testado com ao menos 10 gazettes reais

### Para todo alerta publicado pelo sistema
- [ ] URL do Querido Diário presente no `source`
- [ ] Linguagem factual — sem acusações diretas
- [ ] `confidence >= 0.70` e `riskScore >= 60`
