"""Check source-preserving ECICS ingestion and the committed official extract."""

import gzip
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ecics_import', ROOT / 'scripts/import-ecics.py')
ecics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ecics)


def make_xlsx(rows, headers=ecics.HEADERS):
    """Small standards-shaped shared-string fixture; no spreadsheet dependency."""
    all_rows = [list(headers)] + rows
    texts = []
    string_ids = {}
    sheet = ET.Element(ecics.NS + 'worksheet')
    data = ET.SubElement(sheet, ecics.NS + 'sheetData')
    for number, values in enumerate(all_rows, 1):
        row = ET.SubElement(data, ecics.NS + 'row', r=str(number))
        for col, text in enumerate(values):
            if text not in string_ids:
                string_ids[text] = len(texts)
                texts.append(text)
            cell = ET.SubElement(row, ecics.NS + 'c', r=chr(65 + col) + str(number), t='s')
            ET.SubElement(cell, ecics.NS + 'v').text = str(string_ids[text])
    shared = ET.Element(ecics.NS + 'sst')
    for text in texts:
        ET.SubElement(ET.SubElement(shared, ecics.NS + 'si'), ecics.NS + 't').text = text
    workbook = ET.Element(ecics.NS + 'workbook')
    sheets = ET.SubElement(workbook, ecics.NS + 'sheets')
    ET.SubElement(sheets, ecics.NS + 'sheet', {
        'name': ecics.SHEET_NAME, ecics.REL_NS + 'id': 'rId1', 'sheetId': '1',
    })
    rels = ET.Element(ecics.PKG_NS + 'Relationships')
    ET.SubElement(rels, ecics.PKG_NS + 'Relationship', {
        'Id': 'rId1', 'Target': 'worksheets/sheet1.xml', 'Type': 'x/worksheet',
    })
    ET.SubElement(rels, ecics.PKG_NS + 'Relationship', {
        'Id': 'rId2', 'Target': 'sharedStrings.xml', 'Type': 'x/sharedStrings',
    })
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml', ET.tostring(workbook))
        archive.writestr('xl/_rels/workbook.xml.rels', ET.tostring(rels))
        archive.writestr('xl/worksheets/sheet1.xml', ET.tostring(sheet))
        archive.writestr('xl/sharedStrings.xml', ET.tostring(shared))
        archive.writestr('docProps/core.xml', '''<cp:coreProperties
          xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
          xmlns:dcterms="http://purl.org/dc/terms/">
          <dcterms:created>2026-11-24T13:39:34Z</dcterms:created>
          </cp:coreProperties>''')
    return result.getvalue()


class EcicsImportTests(unittest.TestCase):
    def build(self, rows, **kwargs):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'ECICS.xlsx'
            path.write_bytes(make_xlsx(rows, **kwargs))
            return ecics.build_dataset(path, imported_at='2026-11-25T00:00:00Z')

    def test_retains_distinct_products_for_one_cas_and_full_conditions(self):
        description = 'sensitising emulsion containing:\n— polymers;\n— solvent (CAS RN 108-65-6)'
        index, meta = self.build([
            ['0130136-6', '108-65-6', '37071000', '', 'COMMON', description, ''],
            ['0026971-6', '108-65-6', '29153900', '2-methoxy-1-methylethyl acetate', '', '', ''],
        ])
        self.assertEqual(len(index['records']), 2)
        self.assertEqual(index['records'][1]['chemicalName'], description)
        self.assertEqual(meta['ambiguousCasCount'], 1)
        self.assertEqual(meta['casAssociations'], 2)
        self.assertEqual(meta['validCasCount'], 1)

    def test_preserves_short_cn_and_records_without_cas(self):
        index, meta = self.build([
            ['0011083-8', '7429-90-5', '76', 'aluminium', '', '', ''],
            ['0159423-6', '0-00-0', '29333999', 'unnumbered substance', '', '', ''],
            ['0159424-7', '', '29339980', 'another substance', '', '', ''],
        ])
        self.assertEqual(index['records'][0]['cnCode'], '76')
        self.assertEqual(meta['recordsWithoutValidCasCount'], 2)
        self.assertEqual(meta['placeholderCasCount'], 1)
        self.assertEqual(meta['emptyCasFieldCount'], 1)
        self.assertEqual(meta['cnLengthCounts'], {'2': 1, '8': 2})

    def test_checks_cas_checksum_and_does_not_guess_synonym_separators(self):
        synonyms = '2,2\u2032,2\u2033-nitrilotriethanol; trolamine,triethanolamine'
        index, meta = self.build([
            ['0033862-5', '0-00-0,102-71-6,67-64-2', '29221500', 'triethanolamine', '', '', synonyms],
        ])
        self.assertEqual(index['records'][0]['casNumbers'], ['102-71-6'])
        self.assertEqual(index['records'][0]['synonyms'], [synonyms])
        self.assertEqual(meta['placeholderCasCount'], 1)
        self.assertEqual(meta['invalidCasValueCounts'], {'67-64-2': 1})
        self.assertIsNone(meta['nomenclatureEdition'])
        self.assertEqual(meta['exportedAt'], '2026-11-24T13:39:34Z')
        self.assertEqual(meta['importedAt'], '2026-11-25T00:00:00Z')

    def test_bad_headers_and_duplicate_cus_fail(self):
        row = ['0010079-8', '67-64-1', '29141100', 'propan-2-one', '', '', 'acetone']
        with self.assertRaisesRegex(ValueError, 'Cabeçalhos'):
            self.build([row], headers=('WRONG',) + ecics.HEADERS[1:])
        with self.assertRaisesRegex(ValueError, 'duplicado'):
            self.build([row, row])

    def test_zip_and_xlsx_have_same_index_and_correct_individual_hashes(self):
        xlsx = make_xlsx([['0010079-8', '67-64-1', '29141100', 'propan-2-one', '', '', 'acetone']])
        with tempfile.TemporaryDirectory() as folder:
            plain = Path(folder) / 'ECICS.xlsx'
            wrapped = Path(folder) / 'DDS2-ECICS_Full.zip'
            plain.write_bytes(xlsx)
            with zipfile.ZipFile(wrapped, 'w') as archive:
                archive.writestr('ECICS.xlsx', xlsx)
            first, first_meta = ecics.build_dataset(plain)
            second, second_meta = ecics.build_dataset(wrapped)
            self.assertEqual(first, second)
            self.assertEqual(first_meta['xlsxSha256'], second_meta['xlsxSha256'])
            self.assertNotEqual(first_meta['inputSha256'], second_meta['inputSha256'])
            self.assertEqual(second_meta['inputSha256'], ecics.sha256(wrapped.read_bytes()))
            _, gz1 = ecics.encode_index(first)
            _, gz2 = ecics.encode_index(second)
            self.assertEqual(gz1, gz2)
            self.assertEqual(gz1[4:8], b'\x00\x00\x00\x00')
            # A chunk boundary cannot change the gzip stream or its hash.
            pieces = ecics.split_index(b'x' * (ecics.INDEX_CHUNK_SIZE + 23))
            self.assertEqual([name for name, _ in pieces], ['index.json.gz.0000', 'index.json.gz.0001'])
            self.assertEqual([len(data) for _, data in pieces], [131072, 23])
            self.assertEqual(b''.join(data for _, data in pieces), b'x' * (131072 + 23))
            output = Path(folder) / 'out'
            output.mkdir()
            (output / 'index.json.gz').write_bytes(gz1)
            (output / 'index.json.gz.0001').write_bytes(b'obsolete chunk')
            (output / 'index.json.gz.001').write_bytes(b'not our format')
            (output / 'index.json.gz.0001.backup').write_bytes(b'keep backup')
            manifest = ecics.import_dataset(wrapped, output)
            self.assertEqual(len(manifest['indexChunks']), 1)
            self.assertFalse((output / 'index.json.gz').exists())
            self.assertFalse((output / 'index.json.gz.0001').exists())
            self.assertTrue((output / 'index.json.gz.001').exists())
            self.assertTrue((output / 'index.json.gz.0001.backup').exists())
            reconstructed = b''.join((output / item['file']).read_bytes() for item in manifest['indexChunks'])
            self.assertEqual(reconstructed, gz1)
            self.assertEqual(ecics.sha256(reconstructed), manifest['compressedIndexSha256'])

    def test_unsafe_zip_is_rejected_without_replacing_existing_catalog(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'out'
            output.mkdir()
            prior = output / 'index.json.gz'
            prior.write_bytes(b'previous catalog')
            unsafe = Path(folder) / 'unsafe.zip'
            with zipfile.ZipFile(unsafe, 'w') as archive:
                archive.writestr('../ECICS.xlsx', b'untrusted')
            with self.assertRaisesRegex(ValueError, 'inseguro'):
                ecics.import_dataset(unsafe, output)
            self.assertEqual(prior.read_bytes(), b'previous catalog')
            self.assertFalse((Path(folder) / 'ECICS.xlsx').exists())


class OfficialExtractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.meta = json.loads((ROOT / 'data/ecics/metadata.json').read_text())
        cls.compressed = b''.join((ROOT / 'data/ecics' / item['file']).read_bytes()
                                  for item in cls.meta['indexChunks'])
        cls.raw = gzip.decompress(cls.compressed)
        cls.index = json.loads(cls.raw)
        cls.by_cus = {record['cus']: record for record in cls.index['records']}

    def test_known_extract_totals_and_hash(self):
        self.assertEqual(self.index['schemaVersion'], 1)
        self.assertEqual(len(self.index['records']), 112927)
        self.assertEqual(len(self.by_cus), 112927)
        self.assertEqual(self.meta['validCasCount'], 106652)
        self.assertEqual(self.meta['casAssociations'], 111552)
        self.assertEqual(self.meta['ambiguousCasCount'], 1959)
        self.assertEqual(self.meta['cnLengthCounts'], {'2': 23, '4': 230, '6': 831, '8': 111843})
        self.assertEqual(self.meta['indexSha256'], ecics.sha256(self.raw))
        self.assertEqual(self.meta['compressedIndexSha256'], ecics.sha256(self.compressed))
        self.assertEqual(self.meta['compressedIndexSizeBytes'], len(self.compressed))
        self.assertEqual(len(self.meta['indexChunks']), 34)
        self.assertFalse((ROOT / 'data/ecics/index.json.gz').exists())
        for number, item in enumerate(self.meta['indexChunks']):
            self.assertEqual(item['file'], f'index.json.gz.{number:04d}')
            data = (ROOT / 'data/ecics' / item['file']).read_bytes()
            self.assertEqual(item['sha256'], ecics.sha256(data))
            self.assertEqual(item['size'], len(data))
            self.assertEqual(len(data), 131072 if number < 33 else 112277)

    def test_reference_substances_and_ambiguous_products(self):
        for cus, cas, cn in (
            ('0010079-8', '67-64-1', '29141100'),
            ('0033862-5', '102-71-6', '29221500'),
            ('0023301-2', '144-55-8', '28363000'),
        ):
            self.assertEqual(self.by_cus[cus]['casNumbers'], [cas])
            self.assertEqual(self.by_cus[cus]['cnCode'], cn)
        self.assertEqual(self.by_cus['0011083-8']['cnCode'], '76')
        self.assertEqual(self.by_cus['0016758-8']['cnCode'], '29029000')
        self.assertEqual(self.by_cus['0025461-5']['cnCode'], '38249992')
        self.assertEqual(self.by_cus['0130136-6']['casNumbers'], ['108-65-6'])
        self.assertIn('sensitising emulsion', self.by_cus['0130136-6']['chemicalName'])


if __name__ == '__main__':
    unittest.main()
