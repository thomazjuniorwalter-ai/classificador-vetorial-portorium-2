# Ementas oficiais Cosit

As ementas são suficientes para a pesquisa suplementar autorizada pelo usuário. A recuperação nas classificações individual e em lote não depende de inteiro teor nem de um vector store dedicado.

## Fontes e coleta

O portal Atos Decisórios da Receita e o DOU da Imprensa Nacional são consultados diretamente. O coletor valida autoridade, assunto Classificação de Mercadorias, tipo, número, data, contagem e paginação. Publicações do DOU podem reunir vários atos: cada ementa recebe sua própria identidade. A data da publicação no DOU delimita a busca; a data da decisão identifica o ato.

Identidade: BR/Cosit/tipo/número/ano. SHA-256 identifica o texto. Fontes coincidentes ficam no mesmo registro; diferenças de redação ficam sinalizadas, conservando os links e o texto da Receita. Não se presume que desaparecimento significa revogação.

A captura real de 10/10/2026 reuniu 56 ementas da Receita e 61 ementas do DOU no período de publicação de 01/09 a 10/10/2026: 82 atos distintos após cruzamento. Os atos publicados incluem decisões de agosto. Uma diferença entre fontes ficou sinalizada.

`node scripts/collect-cosit-abstracts.mjs` (Node 24) consulta ambas as fontes e grava o catálogo. O workflow diário às 09h15 de Brasília tem somente `contents: read` e disponibiliza um artefato; não altera main ou publica código. O coletor Python anterior permanece disponível para a Receita.

## Atualização no aplicativo

O servidor coleta as fontes em paralelo e usa o cache de dados do Next com revalidação de 24 horas, acionada pelo acesso. A janela é móvel de 60 dias, somada à captura inicial versionada. Não é uma reconciliação de todo o histórico. O artefato do workflow não é consumido pelo aplicativo; cada caminho coleta diretamente as fontes.

Falha de uma fonte preserva a captura inicial e permite usar a outra, informando disponibilidade. Falha de ambas usa a captura inicial com sua data verdadeira. A revalidação pode servir o resultado anterior enquanto atualiza. A interface mostra a data de coleta e a indisponibilidade; data recente não certifica vigência. Atualizações que saiam da janela móvel exigem reconciliação histórica adicional.

## Busca vetorial

A chave OpenAI já usada pelo Classificador gera embeddings com `text-embedding-3-small`, 512 dimensões. Vetores das ementas públicas ficam em cache limitado em memória; descrições dos usuários não entram nesse cache. São selecionadas até oito ementas por similaridade. Se embeddings falharem, a pesquisa textual é usada e a resposta informa `lexical_fallback`.

O modelo recebe o texto identificado como ementa oficial, os links e instruções para avaliar pertinência da mercadoria, função, composição e apresentação. Similaridade não transfere automaticamente a NCM. Não deve alegar acesso ao inteiro teor. O prompt salvo, as bases anteriores e a autorização do portal são preservados.

As respostas incluem `cositRetrievalStatus`, `cositRetrievalMode` e `cositMetadata`; o endpoint autenticado `/api/cosit/status` informa o estado da coleta sem consumir embeddings.

A integração anterior de íntegra e `scripts/sync-cosit.mjs` permanece opcional. Só atua com manifesto técnico elegível e `OPENAI_COSIT_VECTOR_STORE_ID` configurado; não é necessária para ementas. O manifesto inicial permanece vazio.

## Verificação

`npm test`, `python -m unittest discover -s test -p 'test_cosit*.py'`, `npx tsc --noEmit`, `npm run build`.

Coletores testados com acessos reais à Receita e ao DOU. Testes automatizados verificam decisões agrupadas, contagem incompleta, deduplicação, diferenças entre fontes, ranking com embeddings simulados, fallback e data da captura anterior. Uma classificação real com sessão autenticada e consumo OpenAI ainda precisa ser verificada.
