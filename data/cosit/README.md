# Piloto Cosit — incorporação direta

Walter autorizou em 04/10/2026 a inclusão direta no vetorial, sem revisão manual prévia de decisões. A autorização vale para documentos completos obtidos de fontes oficiais. O código não exige aprovador nem parecer de vigência para indexar. Validação técnica de origem, identidade, hash, duplicatas e íntegra permanece.

## Estado comprovado

A consulta oficial entre 01/09/2026 e 04/10/2026 retornou 53 ementas de Soluções de Consulta Cosit sobre classificação, datadas entre 03 e 30/09/2026, e nenhuma Solução de Divergência no intervalo. Os acessos automáticos testados à íntegra em Normas/NormasInternet2 retornaram HTTP403. Nenhuma íntegra real foi indexada. O armazenamento OpenAI do Classificador ainda não está acessível nesta sessão. A integração em produção e a captura automática de íntegra continuam pendentes; retirar a revisão não resolve esses bloqueios técnicos.

## Coleta de ementas

`python scripts/collect-cosit.py --from 2026-09-01 --to 2026-10-04`

Usa o formulário público do portal Atos Decisórios da Receita, com sessão/ViewState e filtros pelos rótulos oficiais. Confere contagens, datas e tipo; divide intervalos maiores que100 resultados e falha se um único dia exceder100. Falhas preservam o catálogo anterior. Identidade: jurisdição, órgão, tipo, número e ano. SHA-256 identifica mudanças de texto. Não presume que desaparecimento significa revogação. Sinais de alteração/reforma são metadados, sem exigir revisão manual.

`candidates.json` contém ementas, com `ingestionStatus=pending_full_text`. Mudanças produzem `changed_requires_recapture` e preservam versões anteriores. Esses estados significam pendência técnica de obter texto completo correspondente, não aprovação humana.

## Documentos completos

O arquivo `approved.json` mantém seu nome original por compatibilidade, mas agora representa o manifesto técnico e não uma lista de aprovações humanas. Textos oficiais completos devem ser capturados em `data/cosit/full/<identificador>.txt`, com:

| Campo | Conteúdo |
|---|---|
| id | Identidade do catálogo de ementas |
| title / sourceUrl | Identificação e link oficial específico |
| textPath / sha256 | Caminho da íntegra e SHA-256 dos bytes UTF-8 |
| abstractSha256 | Hash da ementa correspondente |
| jurisdiction / integrity | `BR` / `full` |
| ingestionStatus | `ready` para inclusão direta; `retired` para retirada |
| collectedAt | Data da captura oficial |

Não são necessários `reviewedBy`, `reviewedAt` ou `validityCheckedAt`. A captura deve obter efetivamente a íntegra: apenas declarar `integrity=full` ou superar500 caracteres não prova completude. O sincronizador rejeita origem não oficial, caminho inválido, duplicatas, hash divergente e texto igual à ementa. A captura automática da íntegra por um canal acessível ainda precisa ser conectada; não há conversão automática de ementa em decisão completa.

## Sincronização e busca

Usar um store dedicado no mesmo projeto OpenAI da aplicação. O sincronizador e o servidor precisam de `OPENAI_COSIT_VECTOR_STORE_ID`; o sincronizador usa `OPENAI_API_KEY` existente, sem chaves no repositório.

`node scripts/sync-cosit.mjs`

Valida todos os documentos antes de alterar o store, reaproveita identidade/hash existentes, retira versões antigas por atributos, envia novos textos e marca `status=indexed` após a indexação completar. Não há aprovação manual. Não cria store nem apaga arquivos ou altera as bases originais. Documentos não disponíveis no manifesto ficam retirados no store dedicado. Em falha entre upload e vinculação, conferir possíveis arquivos órfãos antes de repetir.

O workflow diário, depois de integrado à branch padrão, coleta ementas às 09h15 de Brasília e salva o catálogo como artefato da execução. Tem somente contents:read: não altera main, não publica o aplicativo e não sincroniza o store. A incorporação automática à base publicada e a sincronização vetorial continuam pendentes. O workflow não obtém sozinho a íntegra. Janela móvel de60dias não substitui reconciliação histórica. Artefatos de execuções com falha podem conter o catálogo anterior; conferir status da execução e data da última coleta bem-sucedida.

As rotas individual e em lote preservam ferramentas do prompt salvo e fazem busca suplementar de textos brasileiros completos indexados. Conferem identidade/hash do manifesto e ementa correspondente, excluindo versões antigas. Citam somente trechos recuperados. A data de coleta não certifica vigência ou aplicabilidade jurídica. `cositRetrievalStatus` distingue falta de configuração, recuperação, ausência de correspondência e indisponibilidade. Manifesto inicial vazio: a integração não está ativa em produção.

## Verificação

`npm test`, `python -m unittest discover -s test -p 'test_cosit*.py'`, `npx tsc --noEmit`, `npm run build`.

Os testes cobrem elegibilidade sem aprovador, filtros, versões antigas, indisponibilidade e validação técnica, além do coletor. Busca é simulada; upload/indexação real dependem da íntegra oficial e do acesso ao store. Próximo teste concreto: capturar uma íntegra real, sincronizar sem revisão manual e conferir sua recuperação no Classificador. EUA e outras jurisdições ficam para conectores posteriores.

Em 10/10/2026, coleta real atualizada: 56 ementas no período de 01/09 a 10/10/2026. Nenhuma íntegra indexada; variável OPENAI_COSIT_VECTOR_STORE_ID ausente na Vercel. Seleção de ato no portal Atos Decisórios exigiu captcha. Não se apresenta ementa como texto completo.
