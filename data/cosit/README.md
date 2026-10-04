# Piloto de atualização Cosit

O catálogo `candidates.json` contém **ementas**, não decisões completas. No teste de 04/10/2026, a consulta oficial entre 01/09/2026 e 04/10/2026 retornou 53 Soluções de Consulta Cosit de classificação de mercadorias e nenhuma Solução de Divergência nesse intervalo. Nenhuma íntegra foi indexada. Este recorte não constitui inventário histórico nem certificação de vigência.

## Coleta

`python scripts/collect-cosit.py --from 2026-09-01 --to 2026-10-04`

O coletor usa o formulário público do portal Atos Decisórios da Receita, com sessão e ViewState, filtros de Cosit, assunto e tipo de ato. Descobre os valores dos filtros pelos rótulos oficiais. Divide intervalos com mais de 100 resultados; interrompe se um único dia ultrapassar esse limite. Confere contagens, datas e tipos; falhas preservam o catálogo anterior e retornam erro. Identidade: jurisdição, órgão, tipo, número e ano; SHA-256 identifica mudanças da ementa. Não presume que uma decisão removida da pesquisa foi revogada.

O workflow `cosit-discovery.yml`, depois de integrado à branch padrão, consulta uma janela móvel de 60 dias diariamente e abre PRs para alterações. Essa janela pode não detectar publicações tardias mais antigas: executar reconciliação histórica com intervalos maiores periodicamente. GitHub deve permitir que Actions crie PRs. Falhas ficam visíveis no workflow; artefatos podem conter o último catálogo, não uma coleta bem-sucedida. PRs repetidos podem ocorrer enquanto alterações anteriores não forem integradas.

## Íntegra e revisão

Os acessos automáticos testados ao sistema Normas e ao endpoint público de íntegra do NormasInternet2 retornaram HTTP 403. Não houve tentativa de contornar o bloqueio. É necessário obter a íntegra oficial por um canal autorizado, inclusive download manual, e revisar antes da indexação. O Classif também não é dependência deste coletor.

Salvar o texto completo oficial em `data/cosit/full/<identificador>.txt`. Registrar em `approved.json`:

| Campo | Conteúdo |
|---|---|
| id | Identidade presente no catálogo de ementas |
| title / sourceUrl | Identificação da decisão e link oficial específico |
| textPath / sha256 | Caminho da íntegra e hash SHA-256 dos bytes UTF-8 |
| abstractSha256 | Hash da ementa revisada do catálogo |
| jurisdiction / integrity | `BR` / `full` |
| reviewStatus | `approved`; usar `retired` para retirar da nova busca |
| reviewedBy / reviewedAt | Responsável pela conferência da íntegra e data |
| validityCheckedAt | Data da conferência de alterações, revogações, reformas, retificações e relações |

A revisão humana deve verificar número, data, produto, NCM, fundamentos e identidade da íntegra; uma ementa ou uma simples contagem de caracteres não comprova completude. O código verifica campos, origem, hash, duplicatas e correspondência à ementa. **Não verifica sozinho o efeito jurídico ou a completude documental.** Reavaliar relações antes de aprovar uma decisão que reforma outra. Atualizações sem aprovação ficam fora da busca; hash da ementa alterado suspende o texto associado até nova revisão.

## Armazenamento vetorial

Usar um vector store dedicado ao piloto, no mesmo projeto OpenAI acessível pela aplicação. Configurar `OPENAI_COSIT_VECTOR_STORE_ID` no servidor e no ambiente controlado do sincronizador; este utiliza `OPENAI_API_KEY` existente. Não armazenar chaves no repositório. Os acessos ao projeto de produção/armazenamento não estavam disponíveis nesta sessão; sincronização real ainda não executada.

`node scripts/sync-cosit.mjs`

O sincronizador valida todo o manifesto antes de fazer alterações, lista os arquivos já vinculados, reaproveita documentos com a mesma identidade/hash, retira versões antigas da pesquisa por atributos, envia novos textos e só os aprova depois da indexação concluir. Não cria automaticamente um store, não apaga arquivos e não altera as bases normativas existentes. Executar em ambiente controlado após a aprovação de cada manifesto; não há upload vetorial automático por cron neste piloto. Mudanças nas relações jurídicas exigem revisão e nova sincronização. Se o upload concluir e a vinculação falhar, pode restar arquivo órfão no projeto OpenAI; conferir o inventário antes de repetir nesse caso.

As rotas individual e em lote fazem uma busca suplementar no store dedicado e preservam as ferramentas do prompt salvo. Filtram arquivos aprovados/íntegros brasileiros e conferem identidade/hash contra o manifesto atual antes de enviar trechos ao modelo. As fontes realmente recuperadas entram na rastreabilidade da análise individual. `cositRetrievalStatus` distingue `not_configured`, `retrieved`, `no_matches` e `unavailable`. Indisponibilidade mantém a análise pelas bases atuais, sem alegar que não existem decisões. O manifesto inicial está vazio: o comportamento atual permanece até configurar o store e aprovar uma íntegra.

## Verificação e próximos passos

`npm test`, `python -m unittest discover -s test -p 'test_cosit*.py'`, `npx tsc --noEmit`, `npm run build`.

Foram testadas coleta real das 53 ementas, rejeição de páginas de erro/truncadas, divisão de intervalos, repetição sem duplicatas, revisão de alterações, elegibilidade, filtros e descarte de versões antigas, falha de busca e validação de manifestos. As chamadas de upload/busca OpenAI são simuladas nos testes; aprovação e indexação ponta a ponta de uma decisão real dependem do acesso ao store e da obtenção de uma íntegra oficial.

Antes de ativar: integrar o PR, permitir o workflow, configurar o store dedicado, obter/revisar uma decisão completa, sincronizar, fazer uma consulta de recuperação conhecida e conferir o parecer e a fonte. Brasil é a única jurisdição habilitada. CROSS/EUA e outras bases ficam para conectores posteriores, com taxonomia e jurisdição próprias.
