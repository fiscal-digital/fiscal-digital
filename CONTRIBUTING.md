# Guia de Contribuição — Fiscal Digital

Obrigado pelo interesse em contribuir! Este guia explica como participar do projeto de forma efetiva.

## Antes de começar

1. Leia o [Código de Conduta](CODE_OF_CONDUCT.md)
2. Abra uma **Issue** antes de codificar — toda mudança começa com discussão pública
3. Leia o [CLAUDE.md](CLAUDE.md) para entender as diretrizes técnicas

## Tipos de contribuição

### Adicionar nova cidade
Abra uma issue com o label `nova-cidade`. Inclua:
- Nome do município e código IBGE
- Confirmação de cobertura no [Querido Diário](https://queridodiario.ok.org.br)
- Link para o diário oficial do município

### Criar novo Fiscal
Abra uma issue com o label `novo-fiscal`. Toda proposta de novo Fiscal **obrigatoriamente** inclui:
- [ ] Referência legal (lei + artigo que justifica a detecção)
- [ ] Exemplo real de gazette que dispara o alerta
- [ ] Exemplo real que **não** deve disparar (falso positivo evitado)
- [ ] Taxa de falso positivo estimada

### Integrar nova fonte de dados
Abra uma issue com o label `nova-fonte`. Inclua:
- URL e documentação da fonte
- Campos disponíveis e formato
- Licença dos dados

### Bug report
Use o template `bug-report` nas Issues.

### Falso positivo
Se identificou um alerta incorreto publicado pelo sistema, abra uma issue com o label `falso-positivo` imediatamente. Seguimos a [Política de Retratação](#política-de-retratação).

## Fluxo de desenvolvimento

```
1. Abra Issue → discuta publicamente
2. Fork do repositório
3. Crie branch: feat/fiscal-obras, fix/cnpj-validator, etc.
4. Implemente com testes
5. Abra PR com o checklist preenchido
6. Aguarde review de ao menos 1 maintainer
7. Merge com squash
```

## Checklist de PR

Todo PR deve ter o checklist preenchido (ver template em `.github/PULL_REQUEST_TEMPLATE.md`).

**Para mudanças em lógica de Fiscal — obrigatório:**
- [ ] Referência legal incluída
- [ ] Exemplo que dispara o alerta
- [ ] Exemplo que NÃO deve disparar
- [ ] Testes passando

## Política de Retratação

Se um alerta publicado for demonstrado incorreto:

1. Abrimos issue pública com label `falso-positivo`
2. Removemos o conteúdo do dashboard
3. Publicamos a correção nas mesmas redes com o mesmo alcance
4. Documentamos o que falhou no modelo para prevenir recorrência

A credibilidade do projeto depende dessa transparência.

## Contato

- GitHub Issues: para bugs e features
- GitHub Discussions: para dúvidas e propostas
- Email: contato@fiscaldigital.org
