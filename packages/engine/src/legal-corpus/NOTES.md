# legal-corpus

Base local de textos integrais de normas usadas pelos Fiscais. Sincronizada de fontes oficiais (planalto.gov.br, stf.jus.br) via `sync.mjs`.

## Por quê

Permite que o agente cite normas com texto verificado, não inferido. Aplica o Princípio Inegociável "Sempre citar a fonte" ao próprio output.

## Estrutura

```
legal-corpus/
├── NOTES.md              (este arquivo)
├── sync-manifest.json    (URLs canônicas + artigos a extrair)
├── sync.mjs              (script de download + parse + persist)
├── index.ts              (API: lookup, validateCitation)
├── _meta.json            (timestamps + checksums por norma)
└── <norma-slug>/
    ├── _index.json       (mapa: artigo → arquivo)
    └── <art-NN>.md       (texto integral + metadata frontmatter)
```

## Como usar

### Atualizar a base
```bash
node packages/engine/src/legal-corpus/sync.mjs            # todas as normas
node packages/engine/src/legal-corpus/sync.mjs lei-14133  # uma norma
```

### Em código TypeScript
```ts
import { lookup, validateCitation } from './legal-corpus'

const texto = lookup('Lei 14.133/2021, Art. 75, II')
// → { norma, artigo, incisos, texto, urlFonte, syncEm }

const check = validateCitation('Lei 14.133/2021, Art. 75, II — limite R$ 65.492,11')
// → { ok: true, source: { ... } }
```

### Bypass do hook check-legal-citation
Citações verificadas contra esta base ganham bypass automático via marca `[legal-verified: legal-corpus/<norma>/<arquivo>]` injetada pelo `validateCitation`.

## Codificação — por que o sync não usa `TextDecoder('windows-1252')`

O planalto serve travessão e aspas curvas como **bytes windows-1252 crus** (`0x96`, `0x93`,
`0x94`, `0x92`) e, em algumas páginas, como **entidade numérica decimal** (`&#150;`) — sem
declarar `charset` em header nem em `<meta>`. Dois problemas:

1. No Node 24, `new TextDecoder('windows-1252')` **não** aplica a tabela cp1252 — resolve como
   latin1 puro, mapeando `0x96` para `U+0096` (controle C1 invisível) em vez de `–` (`U+2013`).
2. `&#150;` decodifica literalmente para o mesmo controle `U+0096`.

Nos dois casos o texto legal canônico ficava com **caractere de controle invisível no lugar da
pontuação** — o tipo de corrupção que passa despercebida em review e quebra comparação exata de
citação. Por isso o `sync.mjs`:

- decodifica a família cp1252/latin1 via `decodeCp1252()` (latin1 + remap explícito da faixa
  `0x80–0x9F` pela tabela WHATWG), e
- reaplica `remapC1Punctuation()` **depois** da decodificação de entidades, cobrindo o caminho `&#150;`.

Guarda: `assertNoC1Controls()` aborta o sync da norma se algum controle C1 sobreviver até o disco —
falha alta em vez de persistir texto corrompido silenciosamente.

> Pendência conhecida: `stf-sv-13/` ainda tem 27 controles C1 de um sync anterior ao fix (fonte
> STF, caminho PowerShell). Re-sincronizar essa norma resolve — a guarda agora impede regressão.

## Política de atualização

- Reajustes anuais (decretos de IPCA): rodar sync em janeiro.
- Alteração legislativa: rodar sync quando publicada no DOU.
- Checksum: `_meta.json` registra hash do texto baixado; mudança aciona revisão de prompts/regras que dependem do dispositivo.

### Alterações detectadas por checksum (registro)

| Data do sync | Norma | Mudança | Ação |
|---|---|---|---|
| 2026-07-25 | Lei 14.133/2021, Art. 75 | **Nova redação do inciso XVI** pela **Lei 15.471/2026** ("produtos estratégicos para a saúde fornecidos por produtores públicos"). Correção (2026-07-28): o registro original desta linha dizia "novo inciso" — errado; o XVI é **original da Lei 14.133** e já teve 4 redações (original, MP 1.166/2023, Lei 14.628/2023, Lei 15.471/2026), todas em `art-75.md:236-294` | `fiscal-licitacoes` coberto pela issue #139: citação explícita de inciso passou a ter precedência e o vocabulário do XVI vigente foi incluído |

## Escopo

Apenas dispositivos efetivamente citados pelos Fiscais (mapeados em `sync-manifest.json`). Quando um Fiscal novo for adicionado, expandir o manifesto + rodar sync.
