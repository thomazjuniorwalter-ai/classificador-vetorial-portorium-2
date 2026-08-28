# Classificador Vetorial Portorium — versão Vercel

Aplicação para consultar o Prompt `CLASSIFICAÇÃO FISCAL 2408` pela Responses API da OpenAI, com descrição textual e até seis documentos por análise.

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

- máximo de 6 documentos por análise;
- máximo de 20 MB por documento;
- a chave precisa pertencer ao mesmo projeto OpenAI que contém o Prompt e seus Vector Stores;
- o Prompt utilizado é a versão 1.

## Estrutura da resposta

A API solicita saída estruturada em três blocos: sugestão de classificação,
descrição aduaneira para o Catálogo de Produtos e justificativa técnica. O
percentual exibido é uma estimativa qualitativa de confiança do modelo, e não
uma probabilidade estatística certificada nem garantia de acerto.

O resultado é apoio técnico. A consulta formal de classificação fiscal à RFB é
regida pela Instrução Normativa RFB nº 2.057, de 9 de dezembro de 2021.

## Execução local opcional

Crie `.env.local` a partir de `.env.example`, cadastre a chave e execute `npm install` e `npm run dev`.
