# Cosit: fontes oficiais, catálogo cumulativo e publicação controlada

## Estado desta alteração

Implementação preparada para revisão. Nenhuma configuração de produção é ativada pelo código. Sem os sinalizadores abaixo, continuam o coletor diário anterior e a recuperação por acesso. Não executar coleta, publicação, geração de embeddings ou sincronização externa como parte da revisão local.

Autorização do portal, prompt salvo, bases normativas, documentos temporários de clientes, NCMs e resultados anteriores são preservados. As rotas continuam autenticando antes da pesquisa. Os dados publicados são exclusivamente documentos públicos oficiais e seus vetores; descrições, documentos e identidades de clientes nunca entram no catálogo.

## Limitação do mecanismo anterior

O workflow executa às 09h15 de Brasília (`15 12 * * *`, UTC) e entrega artefatos; eles não eram consumidos pelo aplicativo. O aplicativo consulta Receita/DOU em paralelo com revalidação de 24 h por acesso, combinando a janela de 60 dias com a captura versionada de 10/10/2026 (82 atos). Isso não acumula atos novos fora da janela, nem reconcilia todo o histórico. Revalidação pode servir cache anterior enquanto atualiza.

## Novo caminho, desativado por padrão

1. O workflow restaura `data/cosit/ledger.json` da branch exclusiva `cosit-catalog-data`.
2. Coleta diretamente os mesmos portais oficiais, com até três tentativas e intervalos de até 14 dias para reduzir truncamentos. Receita usa data do ato; DOU usa data de publicação. As duas datas permanecem distintas.
3. Acrescenta observações imutáveis de conteúdo por ato/fonte/URL/hash; somente `lastSeenAt` avança quando o mesmo conteúdo reaparece. Conserva todas as redações, inclusive alterações na mesma URL e divergências Receita/DOU.
4. Emite recibos por intervalo e fonte: quantidade, resultado, base temporal e SHA do código coletor. Falha parcial ou dupla não apaga textos nem inventa um novo sucesso da fonte que falhou. As execuções com falha ficam vermelhas no Actions e possuem resumo/artefato quando gerados.
5. Opcionalmente prepara embeddings das ementas públicas, por modelo, dimensões e hash. Só textos novos/alterados consomem geração; consultas dos usuários não são persistidas.
6. Publica apenas o ledger validado, em um commit Git cumulativo na branch de dados. `main` e os índices normativos não são escritos. Um inventário remoto alterado durante a coleta bloqueia a publicação; o push não força histórico. Cada commit preserva a versão anterior.
7. Quando ativado no servidor, o aplicativo lê o ledger publicado e usa os mesmos métodos de recuperação semântica/textual. Revalidação de 15 minutos por acesso busca a versão já coletada pelo agendamento, sem repetir a coleta fiscal ao vivo. A rotina diária independe de acessos.

A branch de dados contém somente `data/cosit/ledger.json`. O endereço de leitura é fixo neste repositório e não é configurável por parâmetros de usuário. É um espelho de transporte; as citações fiscais continuam apontando para Receita/DOU. Esta implementação requer que o arquivo dessa branch seja publicamente legível; não colocar segredos ou dados de clientes nele.

Sem publicação válida ou em falha na primeira leitura, a captura inicial é usada com sua data verdadeira e `persistenceStatus: unavailable`. Após uma leitura bem-sucedida, o cache do Next pode conservar a última versão válida em falha de revalidação. Os indicadores de atualização derivam das datas reais por fonte e da janela recente efetivamente consultada. O seed não inventa o texto de uma segunda fonte perdida na antiga consolidação.

## Rastreabilidade e vigência

Identidade do ato: `BR-COSIT-SC|SD-número-ano`. Cada observação conserva texto integral da **ementa**, hash SHA-256, fonte, identidade de origem quando disponível, data do ato, data de publicação quando disponível, primeira e última observação. O ledger inteiro possui revisão por hash, verificável antes do uso; a autenticidade do transporte depende do controle de acesso ao repositório, não apenas desse hash.

Conflitos conservam todos os textos; para recuperação, prefere-se Receita e sinaliza-se a divergência. Isso não equivale a resolver juridicamente a divergência. A versão mais recentemente observada não é declarada vigente. `hasRelationshipSignals` indica necessidade de examinar reforma, revogação, retificação ou divergência. Não há certificação automática de efeitos jurídicos nem inferência de revogação por desaparecimento. Publicações corretivas com outros títulos podem não ser capturadas pelos filtros atuais e exigem verificação complementar. Não afirmar cobertura integral.

As classificações incluem `cositMetadata` com revisão do catálogo, sucesso por fonte, conflitos, disponibilidade da íntegra e IDs/hashes das ementas recuperadas. Os hashes seguem também nas fontes, preservando-os no Excel e nos relatórios; PDF/Word recebem a revisão do catálogo quando existente. Recuperado não significa citado ou aplicável: a fundamentação efetivamente adotada continua na justificativa do modelo, sujeita à revisão profissional. Não é criado banco de análises nem alterados resultados anteriores.

## Reconciliação histórica

A coleta diária é incremental. `workflow_dispatch` aceita `from` e `to` para reconciliação de até 366 dias por execução, dividida em intervalos de 14 dias. Dados anteriores permanecem mesmo quando nenhuma observação é encontrada na nova janela.

Há um agendamento semanal, domingo às 09h45 de Brasília, **ignorado enquanto a persistência e o primeiro ano não forem configurados**. `COSIT_HISTORY_START_YEAR` define o primeiro ano; a cada semana, um ano do intervalo até o atual é revisitado por rotação. O ciclo leva tantas semanas quantos forem os anos configurados e recomeça; não é promessa de revisão diária de todo o histórico. A janela corrente de 60 dias continua diária. Os recibos permitem auditar intervalos consultados; alterações fora dos filtros continuam uma limitação.

## Ativação: somente após aprovação específica

Aprovar separadamente a publicação do catálogo, o consumo pelo aplicativo e eventual geração externa de vetores. Esta PR não cria branch de dados, não muda variáveis/secrets, não dispara workflows e não faz chamadas OpenAI.

| Configuração | Local | Padrão | Efeito após autorização |
| --- | --- | --- | --- |
| `COSIT_PERSISTENCE_ENABLED=true` | GitHub repository variable | ausente | Habilita coleta cumulativa e job de publicação |
| `COSIT_BOOTSTRAP_APPROVED=true` | GitHub repository variable | ausente | Permite criar a branch de dados se ausente; retirar após primeira publicação |
| `COSIT_HISTORY_START_YEAR` | GitHub repository variable | ausente | Primeiro ano autorizado da rotação histórica semanal |
| `COSIT_VECTOR_SYNC_ENABLED=true` | GitHub repository variable | ausente | Habilita geração de embeddings públicos, com consumo OpenAI |
| `OPENAI_API_KEY` | GitHub Actions secret | não alterado | Necessário somente para gerar embeddings no workflow; nunca publicar o valor |
| `COSIT_PERSISTENT_CATALOG=1` | Ambiente do servidor | ausente | Troca a origem Cosit para o catálogo cumulativo publicado |
| `COSIT_CATALOG_COMMIT` | Ambiente do servidor | ausente | Fixa um commit Git de 40 caracteres para auditoria/reversão |

Sequência de ativação proposta: revisar/mesclar código somente com aprovação de produção; autorizar a publicação; conferir primeiro artefato e commit; retirar o bootstrap; autorizar separadamente o consumo pelo aplicativo; validar com sessão autenticada e mercadorias representativas. Vetores são opcionais e exigem aprovação de custo/credencial; o código reutiliza o modelo existente, `text-embedding-3-small`, 512 dimensões. Não provisiona chaves nem altera as existentes.

O job coletor mantém `contents: read`. Somente o job publicador opt-in recebe `contents: write`. Recomenda-se proteção da branch de dados e configuração de notificações de falha do Actions pelo responsável; nenhuma mensagem é enviada a terceiros por estes scripts. O provedor de hospedagem deve ignorar builds da branch de dados, que não contém aplicação.

Reversão: fixar `COSIT_CATALOG_COMMIT` em uma publicação anterior, ou retirar `COSIT_PERSISTENT_CATALOG` para retornar ao caminho por acesso. Desativar `COSIT_PERSISTENCE_ENABLED` interrompe publicações futuras. Nenhum documento remoto é removido na reversão.

## Íntegras: integração independente

`approved.json` continua vazio. O catálogo de ementas não transforma ementa em decisão integral. `validateManifest` exige identidade correspondente à ementa, fonte oficial, hash do texto e arquivo original, caminhos restritos e comprovação técnica de completude:

```json
{
  "completeness": {
    "method": "official-full-text",
    "decisionId": "BR-COSIT-SC-123-2026",
    "verifiedAt": "2026-11-09T12:00:00Z",
    "originalPath": "data/cosit/full/original/SC-123-2026.pdf",
    "originalSha256": "<SHA-256 real dos bytes originais>",
    "evidence": "Registrar como a identidade, a abertura e o encerramento da íntegra foram conferidos."
  }
}
```

Esse registro exige conferência documental real: comprimento e hash, isoladamente, não provam completude. Não foi implementado downloader automático de íntegras nem certificação jurídica de vigência. Novas íntegras precisam de aquisição oficial e manifesto preenchido antes de uma sincronização elegível.

`node scripts/sync-cosit.mjs` agora apenas gera plano local, mesmo com credenciais presentes. Aplicar requer simultaneamente `--apply`, `COSIT_ALLOW_EXTERNAL_SYNC=1`, `--manifest-sha <hash do plano>` e `--store <ID idêntico ao OPENAI_COSIT_VECTOR_STORE_ID>`. Manifesto vazio é bloqueado. Não há integração automática desse script ao workflow.

A sincronização prepara todos os documentos antes de marcar novas versões como indexadas; nunca retira nem apaga versões anteriores ou outros corpora. O aplicativo filtra resultados pelo manifesto e hashes aprovados. A promoção do manifesto usado no aplicativo deve ocorrer somente depois da sincronização integral bem-sucedida. Não existe transação atômica entre todos os arquivos do provedor; uma falha durante marcação pode deixar parte das novas versões indexada, sem retirar as antigas. Uma nova tentativa é idempotente para arquivos já associados e retoma uploads registrados em `.cosit/full-sync-state.json`. Preservar esse checkpoint entre tentativas; perda de resposta de upload ou falha ao salvá-lo pode exigir reconciliação manual de órfãos, sem exclusão automática.

A API de atributos utilizada foi conferida na [documentação oficial OpenAI](https://developers.openai.com/api/reference/resources/vector_stores/subresources/files/methods/update).

## Verificação e limites

Verificação local, sem serviços reais: `npm test`, `python -m unittest discover -s test -p 'test_cosit*.py'`, `npx tsc --noEmit`, `npm run build`, `node scripts/sync-cosit.mjs` (plano vazio). Os testes cobrem 82 atos do seed, retenção fora da janela, duplicidades, redações divergentes, falhas parciais/duplas, geração incremental com transporte simulado, publicação Git em origem local, concorrência, manifesto vazio, falha de indexação e retomada de upload.

O transporte e a publicação bloqueiam snapshots acima de 32 MiB antes de substituir a versão ativa. Quando o histórico atingir esse limite, o acervo precisará ser dividido em arquivos e um índice versionado; o crescimento não é silenciosamente truncado. Os arquivos Git guardam todas as revisões; observações e recibos não são expurgados. Este desenho é a primeira integração cumulativa, com limite operacional explícito.

Continuam pendentes de aprovação e validação real: execução no Actions com publicação habilitada, leitura da branch de dados pelo ambiente hospedado, geração externa de embeddings, aquisição/indexação de íntegras e classificação autenticada usando o novo catálogo. Testes locais não certificam o estado da produção, a cobertura de todos os atos nem a vigência fiscal.
