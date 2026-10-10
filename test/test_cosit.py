import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('collector', Path(__file__).parents[1] / 'scripts/collect-cosit.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class CollectorTests(unittest.TestCase):
    def test_error_page_not_empty_collection(self):
        with self.assertRaises(ValueError): c.parse_results('<html>Forbidden</html>')
    def test_truncated_response_rejected(self):
        with self.assertRaises(ValueError): c.parse_results('Total de atos localizados: 3')
    def test_parse_official_table_structure(self):
        page = '''Total de atos localizados: 1<tbody id="formPrincipal:list_data"><tr data-rk="123"><td>Solução de Consulta</td><td>Cosit </td><td>98000</td><td>30/09/2026</td><td>Assunto: Classificação de Mercadorias</br>Código NCM 8429.52.12</br>Mercadoria: escavadora &amp; acessórios</td></tr></tbody>'''
        total, rows = c.parse_results(page)
        self.assertEqual(total, 1)
        self.assertEqual(rows[0]['integrity'], 'abstract')
        self.assertEqual(rows[0]['ncm'], ['8429.52.12'])
        self.assertIn('& acessórios', rows[0]['abstract'])
    def test_idempotent_and_preserves_prior_decisions(self):
        old = {'id':'SC-1', 'sha256':'a', 'abstract':'a', 'ingestionStatus':'ready_abstract'}
        other = {'id':'SC-2', 'sha256':'c', 'abstract':'c'}
        for r in (old, other): r['decisionDate'] = '2026-09-01'
        self.assertEqual(c.merge([old, other], [old]), [old, other][::-1])
        updated = c.merge([old], [dict(old, sha256='b', abstract='b')])[0]
        self.assertEqual(updated['ingestionStatus'], 'changed_abstract')
        self.assertEqual(updated['previousVersions'], [{'sha256':'a', 'abstract':'a'}])
    def test_large_window_is_split(self):
        class Portal(c.OfficialPortal):
            def __init__(self): self.calls = 0
            def request(self, first, last, kind):
                self.calls += 1
                return (101 if first != last else 0), []
        portal = Portal()
        first = c.dt.date(2026,9,1)
        self.assertEqual(portal.collect(first, first+c.dt.timedelta(days=1), 'Solução de Consulta'), [])
        self.assertEqual(portal.calls, 3)
    def test_too_many_in_one_day_fails_closed(self):
        class Portal(c.OfficialPortal):
            def __init__(self): pass
            def request(self, *args): return 101, []
        day = c.dt.date(2026,9,1)
        with self.assertRaises(ValueError): Portal().collect(day, day, 'Solução de Consulta')
