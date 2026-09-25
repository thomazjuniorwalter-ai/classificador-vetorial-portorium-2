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
