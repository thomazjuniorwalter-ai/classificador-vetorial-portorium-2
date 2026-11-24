# ECICS: referência química europeia por CAS e nome

Esta base contém a exportação ECICS fornecida pelo usuário, gerada pela DG TAXUD em **24/11/2026 às 13:39:34 UTC**. São **112.927 registros CUS**, incluindo os registros sem CAS válido para permitir pesquisa por nome. Os arquivos são destinados à leitura no servidor.

Fonte: [European Customs Inventory of Chemical Substances — ECICS](https://ec.europa.eu/taxation_customs/dds2/ecics/chemicalsubstance_consultation.jsp?Lang=en).

Crédito: Comissão Europeia — DG TAXUD. A Portorium normalizou e indexou os
dados para consulta; os códigos CN e descrições são preservados, enquanto as
referências SH são derivadas somente dos códigos com pelo menos seis dígitos.
Consultar a [política de reutilização e as ressalvas para conteúdo de terceiros](https://commission.europa.eu/legal-notice_en).

## Importar uma nova exportação

O importador usa somente a biblioteca padrão do Python 3.9 ou superior. Aceita o XLSX oficial ou o ZIP que contém um único XLSX. Não baixa dados, não extrai membros do ZIP para o sistema de arquivos e não consulta serviços externos.

O botão oficial "Download all chemical substances" aponta para
<https://ec.europa.eu/taxation_customs/dds2/ecics/ecics_export_management.jsp?message=extractFull>.
Essa URL pode redirecionar para um endereço temporário. Obter uma nova exportação
por esse link e validar seu conteúdo antes da importação; esta integração não
agenda downloads ou atualizações automáticas.

```bash
python3 scripts/import-ecics.py /caminho/DDS2-ECICS_Full.zip
```

Para preparar uma atualização em diretório separado:

```bash
python3 scripts/import-ecics.py /caminho/ECICS.xlsx --output-dir /tmp/ecics-review
```

Revisar as contagens, os hashes e os casos representativos antes de incluir a nova base no aplicativo. Publicar todas as partes `index.json.gz.0000`, `index.json.gz.0001`, etc., junto de `metadata.json`. O gzip completo não é mantido no repositório. Cada parte tem até **131.072 bytes (128 KiB)**; somente a última pode ser menor. O limite é de 256 partes, equivalentes a 32 MiB comprimidos.

O parser valida o arquivo completo antes de substituir as saídas e rejeita cabeçalhos incompatíveis, CUS duplicados, fórmulas, caminhos inseguros e códigos CN malformados. Todas as partes são preparadas e conferidas em arquivos temporários. Cada parte é substituída atomicamente, o conteúdo gravado é conferido pelos hashes individuais e agregado e o manifesto é substituído por último. A atualização conjunta deve ocorrer durante a preparação da versão, sem reimportação em um servidor que esteja atendendo consultas: a substituição individual dos arquivos não é uma transação de todo o diretório.

Após a conferência, o importador remove partes antigas somente quando seus nomes correspondem exatamente a `index.json.gz.` seguido de quatro dígitos. Não percorre subdiretórios e não remove backups ou outros arquivos. O arquivo legado `index.json.gz`, quando presente, só é removido depois de a sequência de partes gravadas reproduzir integralmente o gzip gerado.

O gzip é determinístico (`mtime=0`, sem nome de arquivo no cabeçalho). Os registros são ordenados pelo CUS. As partes são apenas segmentos binários consecutivos de um único fluxo gzip; não são arquivos gzip independentes. Uma nova importação da mesma planilha reproduz os mesmos bytes do índice e das partes. Apenas a data real de importação e, se for diferente, o contêiner de entrada mudam nos metadados.

## Formato do índice

A concatenação das partes, na ordem de `metadata.indexChunks`, recompõe um gzip com JSON UTF-8, `schemaVersion: 1` e `records`. Cada registro tem:

| Campo | Conteúdo e regra |
| --- | --- |
| `cus` | `CUS NUMBER`, preservado como texto com zeros iniciais. É a chave única do registro. |
| `casNumbers` | Lista dos CAS da coluna oficial, separados por vírgula, com estrutura e dígito verificador válidos. Pode estar vazia. |
| `cnCode` | `CN CODE` europeu com 2, 4, 6 ou 8 dígitos, sem completar zeros. |
| `chemicalName` | `FIRST NOMENCLATURE DESCRIPTION` integral; quando vazio, usa `IUPAC DESCRIPTION`. |
| `iupacName` | `IUPAC DESCRIPTION`, inclusive quando já foi usada no campo anterior. |
| `nomenclature` | `FIRST NOMENCLATURE`, por exemplo `COMMON`, `INN`, `INCI` ou vazio. Não é a edição da nomenclatura tarifária. |
| `synonyms` | Lista vazia ou um elemento com o campo `SYNONYMS` original integral. |

Vírgulas e ponto e vírgula também fazem parte de nomes químicos. Por isso o importador não divide o campo de sinônimos em nomes supostamente independentes. O consumidor deve tratar o elemento como texto da fonte. Essa decisão preserva nomes, pontuação e qualificações, e pode limitar uma pesquisa que exija igualdade com um único sinônimo dentro desse texto.

Os marcadores `0-00-0` não se tornam CAS pesquisáveis. CAS inválidos e marcadores são contabilizados nos metadados; a linha química permanece na base. Não são extraídos CAS adicionais de descrições ou sinônimos, pois podem corresponder apenas a componentes mencionados.

## Rastreabilidade e datas

`metadata.json` informa `sourceUrl`, `inputSha256`, `xlsxSha256`, os hashes e tamanhos do índice, `exportedAt`, `exportedBy` e `importedAt`. O hash de entrada identifica o ZIP ou XLSX efetivamente recebido; `xlsxSha256` identifica os bytes da planilha interna. `indexChunks` é uma lista ordenada de objetos `{file, size, sha256}`. Os nomes são contíguos a partir de `index.json.gz.0000`. O consumidor deve validar nome, ordem, tamanho e SHA-256 de cada parte antes de concatená-las, depois conferir `compressedIndexSha256` e, após descomprimir, `indexSha256`.

Nesta exportação são **34 partes**, sendo 33 de 131.072 bytes e a última de 112.277 bytes, totalizando **4.437.653 bytes**. O empacotamento mantém o SHA-256 agregado do gzip `1ba870495177d5b830d06cbe9c3329e07cddb51f8d8f74dd8361034e2d449528` e o SHA-256 do JSON `8911bfb3c1556a94f9627d1b6a7e5c3dfd503fcfa91b2dcf73a002e74743e694`.

`exportedAt` vem de `docProps/core.xml`. `importedAt` registra a execução do importador. **Nenhuma dessas datas comprova vigência jurídica ou atualização individual de uma classificação.** O extrato não declara edição SH/CN, período de vigência ou idioma por registro. Por isso `nomenclatureEdition` é `null` e `validity` é `not_provided_in_extract`.

Contagens da exportação recebida:

| Métrica | Quantidade |
| --- | ---: |
| Registros/CUS únicos | 112.927 |
| CAS válidos distintos (`validCasCount`) | 106.652 |
| Associações CAS–registro (`casAssociations`) | 111.552 |
| CAS com mais de um CN distinto (`ambiguousCasCount`) | 1.959 |
| Registros sem CAS válido | 2.051 |
| CN com 2 / 4 / 6 / 8 dígitos | 23 / 230 / 831 / 111.843 |

`placeholderCasCount` conta ocorrências do marcador, inclusive dentro de listas; `placeholderOnlyRecordCount` conta campos cujo conteúdo completo é `0-00-0`. `invalidCasCount` exclui esses marcadores e soma os demais tokens rejeitados por formato ou dígito verificador. `distinctCnCount` conta códigos europeus distintos, com seus comprimentos originais.

## Uso classificatório e ambiguidades

**A base associa identidade/descrição química a referências CN da União Europeia. Ela não fornece uma conversão automática para NCM brasileira.** O consumidor deve manter CN e NCM em campos separados. Uma eventual referência SH de seis dígitos só pode ser obtida quando o código da fonte tem pelo menos seis dígitos, preservando a ressalva sobre a edição não informada.

Um CAS pode ter vários CUS e vários códigos. Mesmo um registro com apenas um CAS pode descrever uma preparação que contém a substância. O código da preparação não deve ser atribuído à substância pura.

Exemplos preservados no índice:

- CAS `108-65-6`: substância `2-methoxy-1-methylethyl acetate`, CUS `0026971-6`, CN `29153900`; também aparece sozinho no campo CAS de uma emulsão sensibilizante, CUS `0130136-6`, CN `37071000`, cuja descrição especifica polímeros, solvente e outros componentes.
- CAS `1321-74-0`: `divinylbenzene, pure`, CUS `0016758-8`, CN `29029000`; e `divinylbenzene, crude`, CUS `0025461-5`, CN `38249992`.
- CAS `7429-90-5`: alumínio, CUS `0011083-8`, referência de capítulo `76`, além de outros registros de formas/apresentações específicas.

Uma consulta exata por CAS deve conservar todos os registros compatíveis, sem sobrescrever pelo último código nem escolher o primeiro como resposta definitiva. Composição, pureza, apresentação e uso descritos na fonte continuam necessários para avaliar a aplicabilidade. Ausência de CAS na base significa apenas ausência de correspondência nessa exportação.

## Validação

```bash
python3 -m unittest discover -s test -p 'test_ecics_import.py'
```

Os testes verificam ingestão ZIP/XLSX, preservação de qualificações e ambiguidades, códigos curtos, CAS inválidos, proteção contra caminhos inseguros, reprodutibilidade do gzip, reconstrução e hashes das partes, limpeza restrita de partes antigas e os casos conhecidos de acetona (`67-64-1`), trietanolamina (`102-71-6`) e bicarbonato de sódio (`144-55-8`). As contagens de referência correspondem à exportação acima e devem ser revistas, com evidência da nova fonte, quando a base for atualizada.
