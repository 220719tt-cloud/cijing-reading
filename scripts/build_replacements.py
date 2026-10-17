#!/usr/bin/env python3
"""Compile an editorial shortlist, never reverse the query dictionary.
Usage: python3 scripts/build_replacements.py [path/to/existing/ecdict.csv]
Default source is the existing pinned ECDICT checkout used for the query dictionary.
"""
import csv, gzip, hashlib, json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv)>1 else ROOT.parents[1]/'work/dictionary-source/ecdict.csv'
EXPECTED = '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == EXPECTED, 'ECDICT version mismatch'
# These few natural adjective/noun or preposition/noun constructions are explicitly
# reviewed compositions; no generated Cartesian products and no reverse lookup.
COMPOSITIONS = {
 'elderly person':['elderly','person'], 'old house':['old','house'], 'outside the window':['outside','window'],
 'dark green':['dark','green'], 'early morning':['early','morning'],
 'stone bridge':['stone','bridge'], 'mountain road':['mountain','road'],
 'wooden door':['wooden','door'], 'mobile phone':['mobile','phone'],
}
seed_path=ROOT/'data/replacement/curated-pairs.tsv'
seeds=[line.split('|') for line in seed_path.read_text().splitlines() if line and not line.startswith('#')]
local={item['word']:item for name in ['lookup','phrases'] for item in json.loads((ROOT/f'src/features/vocabulary/data/{name}.json').read_text())}
wanted={word for _,english,_,_ in seeds for word in COMPOSITIONS.get(english,[english])}
rows={}
with SOURCE.open() as f:
 for row in csv.DictReader(f):
  if row['word'] in wanted:
   rows[row['word']]={**row,'translation':row['translation'].replace('\\n','\n')}
rules=[]; rejected=[]
for chinese,english,evidence,policy in seeds:
 assert policy in {'noun','count','adjective','predicate','adverb','verb','later','silence','beside','distance','moment','finally'}, policy
 words=COMPOSITIONS.get(english,[english])
 entries=[local.get(word) or rows.get(word) for word in words]
 if not all(entries): rejected.append({'chinese':chinese,'english':english,'reason':'固定版本词典中未找到可核对的完整条目'});continue
 meanings=' / '.join(item['translation'] for item in entries)
 if not all(part in meanings for part in evidence.split(';')):
  rejected.append({'chinese':chinese,'english':english,'reason':'编辑选定的中文义项证据不匹配'});continue
 source_entries=[]
 for word,item in zip(words,entries):
  source_entries.append({'word':word,'meaning':item['translation'], 'source':'; '.join(item.get('sources',[])) or 'ECDICT-MIT'})
 # Store only a source-confirmed plural; do not invent irregular inflections.
 plural=None
 if policy=='count' and len(words)==1:
  for form in rows.get(words[0],{}).get('exchange','').split('/'):
   if form.startswith('s:'): plural=form[2:]
 rules.append({'id':'curated-'+chinese,'chinese':chinese,'english':english,'entryId':english,
  'policy':policy, **({'plural':plural} if plural else {}),
  'evidence':evidence,'sources':source_entries, 'composition':english in COMPOSITIONS})
assert len({r['chinese'] for r in rules})==len(rules)
(ROOT/'data/replacement/source-evidence.json').write_text(json.dumps(rules,ensure_ascii=False,indent=2)+'\n')
runtime=[{k:v for k,v in rule.items() if k not in ['evidence','sources','composition']} for rule in rules]
raw=(json.dumps(runtime,ensure_ascii=False,separators=(',',':'))+'\n').encode()
out=ROOT/'src/features/replacement/data/rules.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(raw)
report={'rules':len(rules),'singleWordTargets':sum(' ' not in r['english'] for r in rules),'phraseTargets':sum(' ' in r['english'] for r in rules),
 'queryDictionaryUnchanged':True, 'previousCandidates':30,'previousExecutableTerms':11,
 'bytes':len(raw),'gzipBytes':len(gzip.compress(raw,mtime=0)), 'sha256':hashlib.sha256(raw).hexdigest(),
 'seedSha256':hashlib.sha256(seed_path.read_bytes()).hexdigest(), 'ecdictSha256':EXPECTED,
 'ecdictCommit':'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b', 'rejected':rejected,
 'deferred':[{'chinese':'充满恐惧','english':'filled with fear','reason':'现有词库没有完整短语证据，暂不为追求密度拼接需系动词或分词语法的表达'},
 {'chinese':'月牙','english':'crescent','reason':'固定源无独立完整条目'}, {'chinese':'外公','english':'grandfather','reason':'当前条目只列祖父，暂不扩展亲属义项'},
 {'chinese':'摇头','english':"shake one’s head",'reason':'需要物主代词及动词变化，留待单独验证'}]}
(ROOT/'data/replacement/build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in ['deferred']},ensure_ascii=False,indent=2))
