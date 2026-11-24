#!/usr/bin/env python3
"""Import an official ECICS XLSX (or its ZIP download) without external packages."""

import argparse
import collections
import datetime as dt
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = 'https://ec.europa.eu/taxation_customs/dds2/ecics/chemicalsubstance_consultation.jsp?Lang=en'
SHEET_NAME = 'DDS2-ECICS Extract'
HEADERS = (
    'CUS NUMBER', 'CAS REGISTRY NUMBERS', 'CN CODE', 'IUPAC DESCRIPTION',
    'FIRST NOMENCLATURE', 'FIRST NOMENCLATURE DESCRIPTION', 'SYNONYMS',
)
COLUMNS = tuple('ABCDEFG')
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL_NS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG_NS = '{http://schemas.openxmlformats.org/package/2006/relationships}'
MAX_INPUT_BYTES = 128 * 1024 * 1024
MAX_MEMBER_BYTES = 512 * 1024 * 1024
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
MAX_ROWS = 1_000_000
MAX_STRINGS = 1_000_000
INDEX_CHUNK_SIZE = 131_072
MAX_INDEX_CHUNKS = 256
CHUNK_FILE_PATTERN = re.compile(r'index\.json\.gz\.[0-9]{4}\Z')
CAS_PATTERN = re.compile(r'[1-9][0-9]{1,6}-[0-9]{2}-[0-9]\Z')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def safe_member_name(name):
    """Validate package paths even though no archive member is ever extracted."""
    path = PurePosixPath(name)
    if (not name or path.is_absolute() or '..' in path.parts or '\\' in name
            or ':' in name or name.startswith('//')):
        raise ValueError('Caminho inseguro no arquivo ZIP: ' + name)
    return name


def check_archive(archive):
    members = archive.infolist()
    names = [item.filename for item in members]
    if len(set(names)) != len(names):
        raise ValueError('O ZIP contém nomes de membros duplicados')
    if sum(item.file_size for item in members) > MAX_ARCHIVE_BYTES:
        raise ValueError('O conteúdo descompactado excede o limite do importador')
    for item in members:
        safe_member_name(item.filename)
        if item.file_size > MAX_MEMBER_BYTES:
            raise ValueError('Membro ZIP excede o limite do importador')
        if item.flag_bits & 1:
            raise ValueError('Arquivos ZIP criptografados não são aceitos')


def read_source(path):
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError('Arquivo de entrada excede 128 MiB')
    original = path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(original)) as archive:
        check_archive(archive)
        if 'xl/workbook.xml' in archive.namelist():
            xlsx, member_name = original, path.name
        else:
            candidates = [item.filename for item in archive.infolist()
                          if not item.is_dir() and item.filename.lower().endswith('.xlsx')]
            if len(candidates) != 1:
                raise ValueError('Esperado um único XLSX dentro do ZIP')
            member_name = candidates[0]
            xlsx = archive.read(member_name)
    return xlsx, {
        'inputFileName': path.name,
        'inputSha256': sha256(original),
        'xlsxFileName': member_name,
        'xlsxSha256': sha256(xlsx),
    }


def xml_root(archive, member):
    with archive.open(safe_member_name(member)) as stream:
        return ET.parse(stream).getroot()


def relationship_target(relationship):
    if relationship.get('TargetMode') == 'External':
        raise ValueError('Relacionamentos externos não são aceitos')
    target = relationship.get('Target', '')
    # Standard XLSX package-absolute paths refer to ZIP members, never disk paths.
    if target.startswith('/xl/'):
        target = target[1:]
    else:
        safe_member_name(target)
        target = posixpath.join('xl', target)
    return safe_member_name(target)


def workbook_members(archive):
    workbook = xml_root(archive, 'xl/workbook.xml')
    relationships = xml_root(archive, 'xl/_rels/workbook.xml.rels')
    relations = {r.attrib['Id']: r for r in relationships.findall(PKG_NS + 'Relationship')}
    sheets = workbook.findall(NS + 'sheets/' + NS + 'sheet')
    matching = [sheet for sheet in sheets if sheet.get('name') == SHEET_NAME]
    if len(matching) == 1:
        sheet = matching[0]
    elif len(sheets) == 1:
        sheet = sheets[0]
    else:
        raise ValueError('Aba ECICS não identificada de forma unívoca')
    rel_id = sheet.get(REL_NS + 'id')
    if rel_id not in relations:
        raise ValueError('Relacionamento da aba ECICS ausente')
    sheet_path = relationship_target(relations[rel_id])
    strings = [r for r in relations.values() if r.get('Type', '').endswith('/sharedStrings')]
    if len(strings) > 1:
        raise ValueError('Mais de uma tabela de textos compartilhados')
    strings_path = relationship_target(strings[0]) if strings else None
    return sheet.get('name'), sheet_path, strings_path


def text_content(element):
    # Formatting/rich-text nodes do not become part of the chemical name.
    return ''.join(item.text or '' for item in element.iter(NS + 't'))


def shared_strings(archive, member):
    if member is None:
        return []
    values = []
    with archive.open(member) as stream:
        parser = ET.iterparse(stream, events=('start', 'end'))
        _, root = next(parser)
        for event, element in parser:
            if event == 'end' and element.tag == NS + 'si':
                values.append(text_content(element))
                element.clear()
                root.clear()
                if len(values) > MAX_STRINGS:
                    raise ValueError('Tabela de textos excede o limite do importador')
    return values


def sheet_rows(archive, member, strings):
    with archive.open(member) as stream:
        parser = ET.iterparse(stream, events=('start', 'end'))
        sheet_data = None
        for event, element in parser:
            if event == 'start' and element.tag == NS + 'sheetData':
                sheet_data = element
            elif event == 'end' and element.tag == NS + 'row':
                values = {}
                for cell in element.findall(NS + 'c'):
                    address = re.fullmatch(r'([A-Z]+)[0-9]+', cell.get('r', ''))
                    if address is None:
                        raise ValueError('Referência de célula inválida')
                    column = address.group(1)
                    if column in values:
                        raise ValueError('Coluna duplicada na mesma linha')
                    if cell.find(NS + 'f') is not None:
                        raise ValueError('Fórmulas não são aceitas no extrato ECICS')
                    kind = cell.get('t')
                    raw = cell.findtext(NS + 'v', '')
                    if kind == 's':
                        if not raw.isascii() or not raw.isdigit() or int(raw) >= len(strings):
                            raise ValueError('Referência inválida a texto compartilhado')
                        value = strings[int(raw)]
                    elif kind == 'inlineStr':
                        value = text_content(cell)
                    elif kind in (None, 'str', 'n'):
                        value = raw
                    else:
                        raise ValueError('Tipo de célula inesperado: ' + str(kind))
                    values[column] = value
                row_number = element.get('r', '?')
                yield row_number, values
                element.clear()
                if sheet_data is not None:
                    sheet_data.clear()


def canonical_cas(value):
    value = value.strip()
    if not CAS_PATTERN.fullmatch(value):
        return None
    digits = value.replace('-', '')
    checksum = sum((index + 1) * int(digit)
                   for index, digit in enumerate(reversed(digits[:-1]))) % 10
    return value if checksum == int(digits[-1]) else None


def export_properties(archive):
    result = {'exportedAt': None, 'exportedBy': None}
    if 'docProps/core.xml' in archive.namelist():
        props = xml_root(archive, 'docProps/core.xml')
        created = props.findtext('{http://purl.org/dc/terms/}created')
        if created:
            # Preserve the actual timestamp and fail on malformed source metadata.
            parsed = dt.datetime.fromisoformat(created.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                raise ValueError('Data de exportação sem fuso horário')
            result['exportedAt'] = parsed.astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
        result['exportedBy'] = props.findtext('{http://purl.org/dc/elements/1.1/}creator')
    return result


def build_dataset(path, imported_at=None):
    xlsx, provenance = read_source(Path(path))
    records = []
    seen_cus = set()
    by_cas = collections.defaultdict(set)
    cas_occurrences = collections.Counter()
    cn_lengths = collections.Counter()
    invalid_cas = collections.Counter()
    placeholders = 0
    placeholder_only = 0
    empty_cas_fields = 0
    duplicate_cas_tokens = 0
    with zipfile.ZipFile(io.BytesIO(xlsx)) as archive:
        check_archive(archive)
        sheet_name, sheet_member, strings_member = workbook_members(archive)
        strings = shared_strings(archive, strings_member)
        rows = sheet_rows(archive, sheet_member, strings)
        _, header = next(rows, (None, {}))
        if tuple(header.get(chr(65 + i), '') for i in range(len(HEADERS))) != HEADERS:
            raise ValueError('Cabeçalhos ECICS ausentes ou incompatíveis')
        if any(value for column, value in header.items() if column not in COLUMNS):
            raise ValueError('Colunas não reconhecidas no extrato ECICS')
        for row_number, cells in rows:
            if not any(value.strip() for value in cells.values()):
                continue
            if any(value for column, value in cells.items() if column not in COLUMNS):
                raise ValueError('Coluna não reconhecida na linha ' + row_number)
            cus, raw_cas, cn, iupac, nomenclature, chemical_name, synonyms = (
                cells.get(chr(65 + i), '').strip() for i in range(len(HEADERS)))
            if not re.fullmatch(r'[0-9]{7}-[0-9]', cus) or cus in seen_cus:
                raise ValueError('CUS inválido ou duplicado na linha ' + row_number)
            if not re.fullmatch(r'(?:[0-9]{2}|[0-9]{4}|[0-9]{6}|[0-9]{8})', cn):
                raise ValueError('CN inválido na linha ' + row_number)
            if not iupac and not chemical_name:
                raise ValueError('Descrição química ausente na linha ' + row_number)
            cas_numbers = []
            if not raw_cas:
                empty_cas_fields += 1
            if raw_cas == '0-00-0':
                placeholder_only += 1
            for token in raw_cas.split(',') if raw_cas else []:
                token = token.strip()
                if token == '0-00-0':
                    placeholders += 1
                    continue
                cas = canonical_cas(token)
                if cas is None:
                    invalid_cas[token] += 1
                elif cas in cas_numbers:
                    duplicate_cas_tokens += 1
                else:
                    cas_numbers.append(cas)
                    by_cas[cas].add(cn)
                    cas_occurrences[cas] += 1
            # Synonym separators are not documented and chemical names contain
            # commas/semicolons. Keep the source field intact instead of guessing.
            records.append({
                'cus': cus,
                'casNumbers': cas_numbers,
                'cnCode': cn,
                'chemicalName': chemical_name or iupac,
                'iupacName': iupac,
                'nomenclature': nomenclature,
                'synonyms': [synonyms] if synonyms else [],
            })
            seen_cus.add(cus)
            cn_lengths[str(len(cn))] += 1
            if len(records) > MAX_ROWS:
                raise ValueError('Quantidade de registros excede o limite do importador')
        properties = export_properties(archive)
    if not records:
        raise ValueError('Extrato ECICS sem registros; catálogo anterior preservado')
    records.sort(key=lambda item: item['cus'])
    imported_at = imported_at or dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
    metadata = {
        'schemaVersion': 1,
        'source': 'ECICS',
        'sourceUrl': SOURCE_URL,
        'authority': 'European Commission — DG TAXUD',
        'jurisdiction': 'EU',
        'nomenclature': 'CN',
        'nomenclatureEdition': None,
        'validity': 'not_provided_in_extract',
        'sheetName': sheet_name,
        **provenance,
        **properties,
        'importedAt': imported_at,
        'recordCount': len(records),
        'validCasCount': len(by_cas),
        'casAssociations': sum(cas_occurrences.values()),
        'distinctCnCount': len({item['cnCode'] for item in records}),
        'ambiguousCasCount': sum(len(codes) > 1 for codes in by_cas.values()),
        'multipleRecordCasCount': sum(count > 1 for count in cas_occurrences.values()),
        'cnLengthCounts': dict(sorted(cn_lengths.items(), key=lambda item: int(item[0]))),
        'recordsWithoutValidCasCount': sum(not item['casNumbers'] for item in records),
        'recordsWithMultipleCasCount': sum(len(item['casNumbers']) > 1 for item in records),
        'emptyCasFieldCount': empty_cas_fields,
        'placeholderCasCount': placeholders,
        'placeholderOnlyRecordCount': placeholder_only,
        'invalidCasCount': sum(invalid_cas.values()),
        'invalidCasValueCounts': dict(sorted(invalid_cas.items())),
        'duplicateCasTokenCount': duplicate_cas_tokens,
        'synonymsEncoding': 'one_original_field_per_array_element',
    }
    return {'schemaVersion': 1, 'records': records}, metadata


def encode_index(index):
    raw = json.dumps(index, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    # GzipFile fixes MTIME and omits the host/path filename in the gzip header.
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode='wb', filename='', mtime=0, compresslevel=9) as stream:
        stream.write(raw)
    return raw, buffer.getvalue()


def split_index(compressed):
    """Transport pieces of one gzip stream; preserve its original aggregate bytes."""
    if not compressed or len(compressed) > INDEX_CHUNK_SIZE * MAX_INDEX_CHUNKS:
        raise ValueError('Índice comprimido vazio ou maior que 32 MiB')
    return [(f'index.json.gz.{number:04d}', compressed[offset:offset + INDEX_CHUNK_SIZE])
            for number, offset in enumerate(range(0, len(compressed), INDEX_CHUNK_SIZE))]


def import_dataset(path, output_dir):
    # Parse and validate everything before replacing any output.
    index, metadata = build_dataset(path)
    raw, compressed = encode_index(index)
    chunks = split_index(compressed)
    metadata.update({
        'indexSha256': sha256(raw),
        'compressedIndexSha256': sha256(compressed),
        'indexSizeBytes': len(raw),
        'compressedIndexSizeBytes': len(compressed),
        'indexChunkSizeBytes': INDEX_CHUNK_SIZE,
        'indexChunks': [{'file': name, 'size': len(data), 'sha256': sha256(data)}
                        for name, data in chunks],
    })
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    pending = []
    try:
        metadata_bytes = (json.dumps(metadata, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        for name, data in [*chunks, ('metadata.json', metadata_bytes)]:
            with tempfile.NamedTemporaryFile(dir=output_dir, prefix='.' + name + '.', delete=False) as stream:
                stream.write(data)
                temporary = Path(stream.name)
            pending.append((temporary, output_dir / name))
            if temporary.read_bytes() != data:
                raise ValueError('Falha na conferência do arquivo temporário: ' + name)
        # Every piece has already been validated. Replace each file atomically,
        # verify the on-disk aggregate, then publish the new manifest last.
        for temporary, target in pending[:-1]:
            temporary.replace(target)
        aggregate_hash = hashlib.sha256()
        aggregate_size = 0
        for chunk in metadata['indexChunks']:
            data = (output_dir / chunk['file']).read_bytes()
            if len(data) != chunk['size'] or sha256(data) != chunk['sha256']:
                raise ValueError('Parte ECICS gravada não corresponde ao manifesto')
            aggregate_hash.update(data)
            aggregate_size += len(data)
        if aggregate_hash.hexdigest() != metadata['compressedIndexSha256'] or aggregate_size != len(compressed):
            raise ValueError('Partes ECICS não reproduzem o gzip original')
        pending[-1][0].replace(pending[-1][1])
        # Cleanup is restricted to this format's exact filenames, never recursive.
        current_files = {chunk['file'] for chunk in metadata['indexChunks']}
        for candidate in output_dir.iterdir():
            if (CHUNK_FILE_PATTERN.fullmatch(candidate.name) and candidate.name not in current_files
                    and (candidate.is_file() or candidate.is_symlink())):
                candidate.unlink()
        # Remove the legacy whole gzip only after the written pieces were checked.
        legacy_gzip = output_dir / 'index.json.gz'
        if legacy_gzip.is_file() or legacy_gzip.is_symlink():
            legacy_gzip.unlink()
    finally:
        for temporary, _ in pending:
            temporary.unlink(missing_ok=True)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='ECICS.xlsx ou o ZIP oficial contendo um único XLSX')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data/ecics')
    args = parser.parse_args()
    result = import_dataset(args.input, args.output_dir)
    print(json.dumps({key: result[key] for key in (
        'recordCount', 'validCasCount', 'casAssociations', 'distinctCnCount',
        'ambiguousCasCount', 'exportedAt', 'compressedIndexSizeBytes', 'indexChunkSizeBytes',
    )}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        print('Importação ECICS falhou: ' + str(error), file=sys.stderr)
        sys.exit(1)
