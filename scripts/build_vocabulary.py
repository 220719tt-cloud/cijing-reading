"""Build a bounded, reproducible subset. Usage: python3 scripts/build_vocabulary.py /path/to/source-directory"""
import csv, gzip, hashlib, json, re, subprocess, sys
from collections import Counter
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
COMMIT = (SOURCE / 'commit.txt').read_text().strip()
EXPECTED_COMMIT = 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b'
assert COMMIT == EXPECTED_COMMIT, 'Review source revision before updating data'
SOURCE_SHA256 = '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf'
assert hashlib.sha256((SOURCE / 'ecdict.csv').read_bytes()).hexdigest() == SOURCE_SHA256, 'Source checksum mismatch'
TARGET = 7000
phrase_wanted = set((ROOT / 'data/vocabulary/novel-phrases.txt').read_text().splitlines())
forced = set('secret world suddenly conspiracy forest river shadow silence courage promise journey mystery whisper lantern memory dream hope danger stranger letter moon light darkness escape trust betrayal discover sword'.split())
rows = {}
def rank(row):
    return min([int(row.get(key) or 0) for key in ['bnc','frq'] if int(row.get(key) or 0) > 0] or [999999])
def clean_translation(value):
    lines = value.replace('\\r','').replace('\\n','\n').splitlines()
    return '\n'.join(line.strip() for line in lines if line.strip() and not re.search(r'\[(?:计|医|法|经|化|机|电|网络|航|建|生|物|军|地质|数|纺)\]', line))
def eligible(row):
    word = row['word']
    return (word == word.lower() or word == 'I') and re.fullmatch(r"[a-z]+(?:[-'][a-z]+)*|I", word) and re.search(r'[\u4e00-\u9fff]', clean_translation(row['translation'])) and (len(word) > 1 or word in ['a','I']) and not re.search(r'\[网络\]|\[地名\]|\[人名\]', row['translation'])
with (SOURCE / 'ecdict.csv').open(encoding='utf-8', newline='') as file:
    for row in csv.DictReader(file):
        key = row['word'].lower().strip()
        if eligible(row) or key in phrase_wanted:
            if re.search(r'[\u4e00-\u9fff]', row['translation']):
                if key not in rows or rank(row) < rank(rows[key]): rows[key] = row
phrases = sorted(phrase_wanted & rows.keys())
missing_phrases = sorted(phrase_wanted - rows.keys())
chosen = {key: rows[key] for key in sorted(forced | set(phrases)) if key in rows}
assert forced <= chosen.keys()
def category(row):
    tags = set(row['tag'].split())
    if row['oxford'] == '1' or rank(row) <= 3000: return 0
    if 'cet4' in tags: return 1
    if 'cet6' in tags: return 2
    if rank(row) <= 15000: return 3
    return 4
def advanced(row):
    tags = set(row['tag'].split())
    return 'ky' in tags and not tags.intersection({'zk','gk','cet4','cet6'}) and row['oxford'] != '1' and rank(row) > 8000
advanced_count = sum(advanced(row) for row in chosen.values())
for key, row in sorted(rows.items(),key=lambda item: (category(item[1]),rank(item[1]),item[0])):
    if len(chosen) == TARGET: break
    if key in chosen or ' ' in key: continue
    if category(row) == 4 and 'ky' not in row['tag'].split(): continue
    if advanced(row):
        if advanced_count >= 80: continue
        advanced_count += 1
    chosen[key] = row
assert len(chosen) == TARGET
entries = []
for key, row in sorted(chosen.items()):
    entries.append({'id':key,'word':row['word'],'phonetic':row['phonetic'], 'translation':clean_translation(row['translation']), 'tags':[tag for tag in row['tag'].split() if tag in ['zk','gk','cet4','cet6','ky']], 'kind':'phrase' if ' ' in key else 'word'})
out = ROOT / 'src/features/vocabulary/data'; out.mkdir(parents=True,exist_ok=True)
raw = (json.dumps(entries,ensure_ascii=False,separators=(',',':'))+'\n').encode()
(out/'lookup.json').write_bytes(raw)
license_path = ROOT/'public/licenses/ECDICT-MIT.txt'; license_path.write_bytes((SOURCE/'LICENSE').read_bytes())
metadata = {'schemaVersion':1,'version':'ecdict-core-7000-v1','source':{'name':'ECDICT','url':'https://github.com/skywind3000/ECDICT','commit':COMMIT,'file':'ecdict.csv','sha256':hashlib.sha256((SOURCE/'ecdict.csv').read_bytes()).hexdigest(),'license':'MIT','licenseFile':'licenses/ECDICT-MIT.txt'},'count':len(entries),'words':sum(e['kind']=='word' for e in entries),'phrases':len(phrases),'advancedOnlyLowFrequency':advanced_count,'tags':dict(Counter(t for e in entries for t in e['tags'])),'bytes':len(raw),'gzipBytes':len(gzip.compress(raw,mtime=0)),'sha256':hashlib.sha256(raw).hexdigest(),'missingPhraseCandidates':missing_phrases}
(out/'manifest.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')

# The editorial replacement table is independent; it never reverses dictionary definitions.
replacements = json.loads((ROOT/'data/vocabulary/novel-replacements.json').read_text())
lookup = {entry['id']:entry for entry in entries}
for candidate in replacements:
    assert candidate['entryId'] in lookup
    assert candidate['enabled'] is False and candidate['status'] == 'candidate'
    candidate['sourceMeaning'] = lookup[candidate['entryId']]['translation'].split('\n')[0]
replacement_raw = (json.dumps(replacements,ensure_ascii=False,separators=(',',':'))+'\n').encode()
(out/'replacements.json').write_bytes(replacement_raw)
public_replacements = ROOT/'public/vocabulary/replacements.json'
public_replacements.parent.mkdir(parents=True,exist_ok=True)
public_replacements.write_bytes(replacement_raw)
metadata['replacementCandidates'] = len(replacements)
metadata['replacementBytes'] = len(replacement_raw)
metadata['replacementGzipBytes'] = len(gzip.compress(replacement_raw,mtime=0))
metadata['replacementSha256'] = hashlib.sha256(replacement_raw).hexdigest()
metadata['sourceTagNote'] = 'Exam tags overlap and are inherited from ECDICT, not an official complete syllabus.'
(out/'manifest.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')

if (ROOT/'scripts/build_phrases.py').exists():
    subprocess.run([sys.executable, str(ROOT/'scripts/build_phrases.py'), str(SOURCE)], check=True)
else:
    print(json.dumps(metadata,ensure_ascii=False,indent=2))
