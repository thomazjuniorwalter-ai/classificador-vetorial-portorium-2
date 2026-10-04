# Classificador Vetorial Portorium — versão Vercel

Aplicação para consultar o Prompt `CLASSIFICAÇÃO FISCAL 2408` pela Responses API da OpenAI, com descrição textual e até dez documentos por análise.

## Publicação sem expor a API key

1. Crie um repositório privado no GitHub e envie o conteúdo desta pasta.
2. Na Vercel, selecione **Add New → Project** e importe o repositório.
3. Abra **Settings → Environment Variables**.
4. Cadastre `OPENAI_API_KEY` com sua chave e selecione Production, Preview e Development.
5. Não use prefixo `NEXT_PUBLIC_`: isso exporia a chave no navegador.
6. Clique em **Deploy**. Se a variável for incluída depois da primeira publicação, faça **Redeploy**.

## Teste

Digite uma descrição ou anexe documentos e clique em **Analisar mercadoria**. A página não contém classificação simulada: resultados são devolvidos pelo Prompt da OpenAI.

## Limites desta versão

- máximo de 10 documentos por análise;
- máximo de 10 MB por documento;
- a chave precisa pertencer ao mesmo projeto OpenAI que contém o Prompt e seus Vector Stores;
- o Prompt utilizado é a versão 1.

## Estrutura da resposta

A API solicita saída estruturada em três blocos: sugestão de classificação,
descrição aduaneira para o Catálogo de Produtos e justificativa técnica. O
percentual exibido é uma estimativa qualitativa de confiança do modelo, e não
uma probabilidade estatística certificada nem garantia de acerto.

O resultado é apoio técnico. A consulta formal de classificação fiscal à RFB é
regida pela Instrução Normativa RFB nº 2.057, de 9 de dezembro de 2021.

## Relatório da classificação em PDF e Word

Depois de uma análise individual, **Baixar PDF** e **Baixar Word** exportam o
resultado em arquivo paginado, com identidade Portorium, NCM sugerida,
confiança estimada, descrição aduaneira, justificativa e referências presentes
na resposta, informações pendentes e aviso de revisão humana. O relatório
inclui o analista, a data, o identificador da análise, a descrição e os nomes
dos anexos usados naquela execução. Alterações posteriores nos campos não
modificam esses dados do relatório. Não são inventadas fontes adicionais.

A geração ocorre no navegador, sem nova chamada à OpenAI ou novo envio dos
documentos. O Word é editável. No PDF, caracteres não suportados pela fonte
padrão são representados pelo código Unicode. A exportação Excel da triagem
em lote permanece disponível; cada item pode ser aprofundado para gerar seu
relatório completo em PDF ou Word.

## Triagem de mercadorias em lote

A aba **Triagem em lote** recebe planilhas `.xlsx` de até 2 MB, com títulos de
coluna na primeira linha e até 50 mercadorias por rodada. A pessoa escolhe a
coluna que contém a NCM do cliente e até seis colunas com características
técnicas. Por exemplo: `Produto`, `Descrição técnica`, `Composição`, `Função` e
`NCM do cliente`. Valores que dependem de fórmulas devem ser colados como
valores antes do envio; células vazias e NCM inválidas são indicadas antes de
qualquer chamada paga à API.

Cada mercadoria gera uma análise independente pelo mesmo prompt versionado da
consulta individual. **A NCM do cliente não é enviada à OpenAI**; o servidor
recebe apenas o texto técnico e retorna `ncm` e `confianca`. A comparação é
feita no aplicativo: verde quando há coincidência e confiança estimada de pelo
menos 80%; vermelho quando há divergência e confiança estimada de pelo menos
80%; amarelo para os demais casos, incluindo NCM não determinada. Trata-se
de priorização para revisão, não de confirmação, refutação ou probabilidade
estatisticamente validada. O usuário pode aprofundar cada linha na análise
individual e baixar a lista em Excel. Os resultados são mantidos na sessão do
navegador enquanto a página estiver aberta; não há histórico persistente.

Cada linha consultada consome uma chamada à API da OpenAI. A triagem processa
duas linhas em paralelo, mantém resultados parciais após interrupção e permite
repetir apenas as linhas que falharam.

## Execução local opcional

Crie `.env.local` a partir de `.env.example`, cadastre a chave e execute `npm install` e `npm run dev`.


## Parecer e recuperação normativa
A análise individual exporta PDF e Word editável como parecer técnico preliminar, com objeto, elementos técnicos, fundamentação, arquivos recuperados, conclusão, pendências, disclaimer e campos para revisão profissional. Os documentos exportados preservam a resposta recebida; não inventam fundamentos ausentes.
Anexos pesquisáveis são lidos em uma chamada separada (gpt-5-mini). A chamada de classificação usa as ferramentas do prompt armazenado, sem substituí-las pela base temporária dos anexos. Há uma chamada adicional de API quando existem anexos pesquisáveis. A resposta distingue trecho não recuperado de documento ausente do acervo. Os nomes retornados pela pesquisa não certificam vigência ou aplicabilidade. O inventário e a configuração do acervo permanente ainda precisam ser verificados no projeto OpenAI.


## Catálogo de Produtos — preparação e auditoria

A aba Catálogo consulta o JSON oficial de vínculos NCM/atributos do Portal Único,
com cache de uma hora e identificação de versão, vigência e fonte. Considera
atributos de importação com objetivo Produto, listas oficiais e condições
aninhadas. A NCM deve ser revisada pela pessoa; este módulo não a classifica.

As sugestões usam gpt-5-mini e só entram quando o valor é válido no domínio
oficial e o trecho existe literalmente na descrição ou em arquivo recuperado.
Todo valor sugerido exige revisão humana. A leitura de anexos utiliza uma base
vetorial temporária removida ao final. Estruturas especiais não suportadas ficam
sinalizadas para revisão manual; atributos multivalorados são preenchidos
manualmente nesta etapa.

A auditoria recebe JSON de produtos ou XLSX de até 2 MB/50 linhas. No Excel, use
colunas NCM, Denominação, Descrição e códigos ATT_...; valores múltiplos são
separados por |. Fórmulas devem ser coladas como valores. O relatório verifica
preenchimento, condições e domínio dos atributos, sem confirmar a NCM.

Os downloads são documentos de revisão Portorium, não arquivos prontos para
importação. Os dados ficam apenas na sessão; baixe antes de sair. Esta etapa
não autentica no Siscomex nem transmite cadastros. Usa a autorização já existente
do Classificador. A leitura autenticada do catálogo é a próxima fase.

Validação: npm test (18 testes), npm run build e conferência de tela em desktop
e celular. A base oficial completa foi percorrida sem erro de resolução de NCM.
Os testes de IA usam respostas simuladas; a primeira execução real com OpenAI
ainda precisa ser conferida no ambiente de revisão.

### Consulta autenticada ao Catálogo (fase 2, versão de teste)

Na aba Catálogo de Produtos, a consulta usa o par Client-Id/Client-Secret gerado no Portal Único com perfil IMPEXP. O usuário informa o CPF do catálogo ou o CNPJ raiz (8 dígitos), escolhe Produção ou Treinamento/Validação e pode filtrar por NCM. As chaves não são persistidas, os campos são apagados ao enviar e os tokens permanecem apenas na execução do servidor. A rota exige a autorização existente e origem do próprio aplicativo; mensagens externas não são devolvidas ao navegador.

O servidor autentica em `/portal/api/autenticar/chave-acesso` e consulta por GET `/catp/api/ext/produto`, sem endpoints de manutenção. Resultados parciais são identificados. O teste limita a consulta a 50 produtos e 2 MB; catálogos maiores precisam de filtro. O resultado pode ser levado à auditoria vigente de atributos. Produtos com modalidade AMBOS também podem ser auditados para importação. Não há sincronização permanente ou transmissão de cadastros.

Contrato conferido em 04/10/2026: https://docs.portalunico.siscomex.gov.br/api/plat/plat-auth.json e https://docs.portalunico.siscomex.gov.br/api/catp/catp.json. Os testes locais usam transporte simulado; a autenticação e a consulta reais dependem do teste pelo usuário com suas chaves. O Siscomex pode bloquear autenticações repetidas em menos de 60 segundos.
