"""Discover official Cosit classification abstracts. Never promote an abstract to full text."""
import argparse
import datetime as dt
import hashlib
import html
import http.cookiejar
import json
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request

SOURCE = 'https://atosdecisorios.receita.fazenda.gov.br/consultaweb/index.jsf'
ROOT = Path(__file__).resolve().parents[1]


def text(value):
    value = re.sub(r'<br\s*/?>|</br>|</p>', '\n', value, flags=re.I)
    return html.unescape(re.sub(r'<[^>]+>', '', value)).strip()


def choice(page, field, label):
    inputs = dict(re.findall(r'<input\b[^>]*id="([^"]+)"[^>]*value="([^"]+)"', page))
    for identifier, caption in re.findall(r'<label\b[^>]*for="([^"]+)"[^>]*>(.*?)</label>', page, re.S):
        if identifier.startswith('formPrincipal:' + field + ':') and text(caption).startswith(label):
            return html.unescape(inputs[identifier])
    raise ValueError('Filtro oficial não encontrado: ' + label)


def parse_results(page):
    count = re.search(r'Total de atos localizados:\s*(\d+)', page)
    if not count:
        # Fail closed: a changed page/login/error must never be interpreted as no results.
        raise ValueError('Resposta sem contagem de atos; coleta não confirmada')
    total = int(count.group(1))
    body = re.search(r'<tbody[^>]*id="formPrincipal:list_data"[^>]*>(.*?)</tbody>', page, re.S)
    rows = []
    for identifier, row in re.findall(r'<tr\b[^>]*data-rk="([^"]+)"[^>]*>(.*?)</tr>', body.group(1) if body else '', re.S):
        cells = [text(c) for c in re.findall(r'<td\b[^>]*>(.*?)</td>', row, re.S)]
        if len(cells) != 5 or cells[1] != 'Cosit' or 'Classificação de Mercadorias' not in cells[4]:
            raise ValueError('Linha fora dos filtros esperados')
        kind, _, number, date, abstract = cells
        if kind not in ('Solução de Consulta', 'Solução de Divergência'):
            raise ValueError('Tipo de ato inesperado')
        date_iso = dt.datetime.strptime(date, '%d/%m/%Y').date().isoformat()
        digest = hashlib.sha256(abstract.encode()).hexdigest()
        rows.append(dict(id=f'BR-COSIT-{"SC" if kind == "Solução de Consulta" else "SD"}-{number}-{date_iso[:4]}',
                         sourceRecordId=identifier, jurisdiction='BR', authority='Cosit', type=kind,
                         number=number, decisionDate=date_iso, sourceUrl=SOURCE,
                         integrity='abstract', ingestionStatus='pending_full_text', validity='unverified',
                         ncm=sorted(set(re.findall(r'\b\d{4}\.\d{2}\.\d{2}\b', abstract))),
                         abstract=abstract, sha256=digest,
                         hasRelationshipSignals=bool(re.search(r'revog|reform|anul|retific|diverg', abstract, re.I))))
    if len(rows) > total or (total <= 100 and len(rows) != total):
        raise ValueError('Contagem de resultados inconsistente')
    return total, rows


class OfficialPortal:
    def __init__(self):
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, first, last, kind):
        page = self.client.open(SOURCE, timeout=30).read().decode('utf-8')
        view = re.search(r'name="javax.faces.ViewState"[^>]*value="([^"]+)"', page)
        if not view:
            raise ValueError('Formulário oficial indisponível')
        params = {'formPrincipal': 'formPrincipal', 'javax.faces.ViewState': html.unescape(view.group(1)),
                  'formPrincipal:inpTextoPesquisavel': '',
                  'formPrincipal:selectUnidade': choice(page, 'selectUnidade', 'Cosit'),
                  'formPrincipal:selectTipoAto': choice(page, 'selectTipoAto', kind),
                  'formPrincipal:selectAssunto': choice(page, 'selectAssunto', 'Classificação de Mercadorias'),
                  'formPrincipal:dataAtoInicial_input': first.strftime('%d/%m/%Y'),
                  'formPrincipal:dataAtoFinal_input': last.strftime('%d/%m/%Y'),
                  'formPrincipal:btnPesq': 'Pesquisar'}
        result = self.client.open(urllib.request.Request(SOURCE, data=urllib.parse.urlencode(params).encode()), timeout=30)
        return parse_results(result.read().decode('utf-8'))

    def collect(self, first, last, kind):
        total, rows = self.request(first, last, kind)
        if total > 100:
            if first == last:
                raise ValueError('Mais de 100 atos no mesmo dia; paginação necessária, coleta interrompida')
            middle = first + (last - first) // 2
            return self.collect(first, middle, kind) + self.collect(middle + dt.timedelta(days=1), last, kind)
        if any(not first.isoformat() <= row['decisionDate'] <= last.isoformat() or row['type'] != kind for row in rows):
            raise ValueError('Portal não respeitou os filtros da consulta')
        return rows


def merge(previous, discovered):
    records = {r['id']: r for r in previous}
    for item in discovered:
        old = records.get(item['id'])
        if old and old['sha256'] != item['sha256']:
            item = dict(item, ingestionStatus='changed_requires_recapture',
                        previousVersions=old.get('previousVersions', []) + [{k: old[k] for k in ('sha256', 'abstract')}])
        elif old:
            item = old  # Repeated runs don't produce artificial diffs.
        records[item['id']] = item
    return sorted(records.values(), key=lambda r: (r['decisionDate'], r['id']), reverse=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--from', dest='first', default=(dt.date.today() - dt.timedelta(days=60)).isoformat())
    parser.add_argument('--to', dest='last', default=dt.date.today().isoformat())
    parser.add_argument('--output', type=Path, default=ROOT / 'data/cosit/candidates.json')
    args = parser.parse_args()
    first, last = dt.date.fromisoformat(args.first), dt.date.fromisoformat(args.last)
    if first > last:
        raise ValueError('Intervalo de datas inválido')
    portal = OfficialPortal()
    discovered = []
    for kind in ('Solução de Consulta', 'Solução de Divergência'):
        discovered.extend(portal.collect(first, last, kind))
    previous = json.loads(args.output.read_text()) if args.output.exists() else {'records': []}
    catalog = {'schemaVersion': 1, 'source': SOURCE, 'records': merge(previous['records'], discovered)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix('.tmp')
    temp.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    temp.replace(args.output)  # Only replace after BOTH collections succeeded.
    print(json.dumps({'status': 'collected_abstracts', 'from': args.first, 'to': args.last,
                      'discovered': len(discovered), 'catalog': len(catalog['records']), 'indexedFullTexts': 0}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Coleta falhou; catálogo anterior preservado: ' + str(error), file=sys.stderr)
        sys.exit(1)
