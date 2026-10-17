"""Reproducible phrase expansion; source CSV remains outside the published project.
Usage: python3 scripts/build_phrases.py /path/to/ecdict-source
"""
import csv, gzip, hashlib, json, re, sys, unicodedata
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(sys.argv[1]); INPUT=ROOT/'data/vocabulary'; OUTPUT=ROOT/'src/features/vocabulary/data'
def norm(value):return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',value).lower().strip().replace('’',"'"))
def read(path):return json.loads(path.read_text())
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')
assert hashlib.sha256((SOURCE/'ecdict.csv').read_bytes()).hexdigest()=='1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf'
source_meta=read(INPUT/'phrase-sources/sources.json')
for filename,expected in source_meta['englishPhrases']['files'].items():assert hashlib.sha256((INPUT/'phrase-sources'/filename).read_bytes()).hexdigest()==expected
assert hashlib.sha256((INPUT/'phrase-sources/cedict-evidence.txt').read_bytes()).hexdigest()==source_meta['cedict']['evidenceSha256']
review=read(INPUT/'phrase-review.json')
lists={name:{norm(line) for line in (INPUT/f'phrase-sources/{name}.txt').read_text().splitlines() if line.strip()} for name in ['cet6','npee','cet4','senior','junior']}
legacy=set(read(INPUT/'legacy-phrases.json')); assert len(legacy)==77
required=set('think of|think about|figure out|give up|carry out|account for|be aware of|in terms of|give rise to|without hesitation'.split('|'))
base=read(OUTPUT/'lookup.json'); assert len(base)==7000
wanted=set.union(*lists.values(),legacy,required)
rows={}; ranks={}
for row in csv.DictReader((SOURCE/'ecdict.csv').open(encoding='utf-8',newline='')):
 key=norm(row['word'])
 if key in wanted:rows.setdefault(key,[]).append(row)
 if ' ' not in key:
  rank=min([int(row.get(field) or 0) for field in ['bnc','frq'] if int(row.get(field) or 0)>0] or [99999])
  ranks[key]=min(ranks.get(key,99999),rank)

def clean(value):
 return '\n'.join(line.strip() for line in value.replace('\\r','').replace('\\n','\n').splitlines() if line.strip() and not re.search(r'\[(?:计|医|法|经|化|机|电|网络|航|建|生|物|军|地质|数|纺)\]',line))
# Grammar/type labels describe the phrase shape; they are not official exam syllabus claims.
verbs=set('account apologize act add agree aim allow answer appeal apply argue arrive ask attach attend back bear beat become beg begin believe belong bend blame blow break bring brush build burn burst buy call calm care carry catch change chase check cheer choose clean clear climb close come compare complain concentrate consist count cover cross cry cut deal decide depend devote die differ dig do draw dream dress drink drive drop eat end enter escape exchange fall feed feel fight figure fill find finish fit fix fly focus follow force forget forgive gain gather get give go grow guard hand hang happen have hear help hide hit hold hope hurry insist introduce join jump keep kick knock laugh lay lead lean leave lend let lie lift light listen live lock long look lose love make meet mind miss move name need notice object occur offer open order owe pass pay pick play point pour pray prefer prepare press prevent prove provide pull push put raise reach read reason receive recognize refer reflect refuse rely remain remind remove reply report respond rest result return ride ring rise roll rub rule run rush save search see seek seem sell send serve set settle shake share shine shoot show shut sing sink sit sleep slide slip smile speak spend split spread spring stand stare start stay step stick stop stretch strike struggle study succeed suffer suggest supply suppose sweep swim switch take talk teach tear tell tend thank think throw tie touch train treat tremble trust try turn understand use visit wait wake walk want warn wash watch wave wear win wish wonder work worry wrap write be'.split())
nonverb={'work of art','work force','call of nature','fall of night','leave of absence','run of the mill','close to','close by','back and forth','back to back','long ago','long before','long after','last but not least'}
def verb_phrase(key):return key.split()[0] in verbs and key not in nonverb
skip=[]; candidates={}
for key in sorted(wanted):
 if key=='without hesitation':continue
 if key in review:
  skip.append({'phrase':key,'reason':'editorial-review','detail':review[key]});continue
 if not re.fullmatch(r"[a-z]+(?:[-'][a-z]+)*(?: [a-z]+(?:[-'][a-z]+)*){1,8}",key):
  skip.append({'phrase':key,'reason':'unsupported-template-or-punctuation'});continue
 valid=[]
 for row in rows.get(key,[]):
  translation=clean(row['translation'])
  if re.search(r'[\u4e00-\u9fff]',translation) and not re.search(r'\[(?:人名|地名|网络)\]',translation):valid.append(translation)
 if not valid:
  skip.append({'phrase':key,'reason':'no-confirmed-general-chinese-definition'});continue
 # Keep original multi-sense definition strings; splitting is only a display aid.
 meanings=[]
 for translation in valid:
  for line in translation.splitlines():
   line=re.sub(r'^(?:n|v|vt|vi|a|adj|adv|prep|conj|interj|pron)\.\s*','',line)
   for meaning in re.split(r'[,;；，]\s*',line):
    meaning=meaning.strip()
    if meaning and meaning not in meanings:meanings.append(meaning)
 tags=[tag for tag in ['cet4','cet6'] if key in lists[tag]]
 if key in lists['npee']:tags.append('ky')
 memberships=[name for name in lists if key in lists[name]]
 phrase_type='verb-phrase' if verb_phrase(key) else 'prepositional-phrase' if key.split()[0] in {'in','on','at','by','for','with','without','under','over','out','from','to','of','beyond','within'} else 'fixed-expression'
 candidates[key]={'id':key,'word':key,'phonetic':'','translation':'\n'.join(dict.fromkeys(valid)),'tags':tags,'kind':'phrase','meanings':meanings,'difficulty':(['common'] if key in lists['junior'] or key in lists['senior'] or key in legacy else [])+(['cet6'] if 'cet6' in tags else [])+(['postgraduate'] if 'ky' in tags else []),'phraseType':phrase_type,'category':'','sources':['ecdict']+(['english-phrases'] if memberships else []),'sourceEntries':{'ecdict':key,'english-phrases':memberships},'forms':[]}
# Small, source-verified supplements: preserve the exact evidence with the data sources.
evidence=(INPUT/'phrase-sources/cedict-evidence.txt').read_text()
assert '/without hesitation/' in evidence and '想到 想到 ' in evidence
candidates['without hesitation']={'id':'without hesitation','word':'without hesitation','phonetic':'','translation':'毫不犹豫；毅然；毅然决然','tags':[],'kind':'phrase','meanings':['毫不犹豫','毅然','毅然决然'],'difficulty':['common'],'phraseType':'prepositional-phrase','category':'','sources':['cc-cedict'],'sourceEntries':{'cc-cedict':['毫不犹豫','毅然','毅然决然']},'forms':[]}
assert 'think of' in candidates
think=candidates['think of'];think['meanings']=list(dict.fromkeys(['想到','想起','考虑','认为']+think['meanings']));think['translation']='；'.join(think['meanings']);think['sources'].append('cc-cedict');think['sourceEntries']['cc-cedict']=['想到','想起'];think['editorialNote']='想到、想起与CC-CEDICT核对；认为归并自ECDICT的“有...的看法”，原有义项仍保留。'
assert (required|legacy)<=candidates.keys(),f'Unverified required/legacy: {(required|legacy)-candidates.keys()}'
# Rank for everyday reading: school/common memberships, familiar component words, shorter forms.
def score(key):
 words=key.split(); frequency=sum(min(ranks.get(word,99999),20000) for word in words)/len(words)
 return (0 if key in lists['junior'] else 1 if key in lists['senior'] else 2,frequency,len(words),key)
selected={}
quotas={'common-verb':400,'cet6':350,'postgraduate':350,'daily-reading':200}
for key in sorted(legacy|required):
 cat='common-verb' if verb_phrase(key) else 'daily-reading'
 selected[key]=cat
for category,predicate in [('common-verb',verb_phrase),('cet6',lambda key:key in lists['cet6']),('postgraduate',lambda key:key in lists['npee']),('daily-reading',lambda key:key in lists['junior'] or key in lists['senior'])]:
 count=sum(value==category for value in selected.values())
 for key in sorted(candidates,key=score):
  if count>=quotas[category]:break
  if key in selected or not predicate(key):continue
  selected[key]=category;count+=1
 assert count==quotas[category],(category,count)
assert len(selected)==1300
entries=[]
for key,category in sorted(selected.items()):
 entry=candidates[key];entry['category']=category
 if not entry['difficulty']:entry['difficulty']=['common']
 entries.append(entry)
# Exact source-backed verb forms are aliases, not fabricated extra headwords.
forms={}
for row in csv.DictReader((SOURCE/'ecdict.csv').open(encoding='utf-8',newline='')):
 key=norm(row['word'])
 if key not in verbs:continue
 for item in row['exchange'].split('/'):
  if ':' not in item:continue
  tag,form=item.split(':',1)
  if tag in ['p','d','i','3'] and re.fullmatch('[a-z]+',form):forms.setdefault(key,set()).add(form)
for entry in entries:
 tokens=entry['id'].split()
 entry['forms']=sorted({' '.join([form]+tokens[1:]) for form in forms.get(tokens[0],[]) if form!=tokens[0]})
raw=(json.dumps(entries,ensure_ascii=False,separators=(',',':'))+'\n').encode();(OUTPUT/'phrases.json').write_bytes(raw)
write(INPUT/'phrase-exclusions.json',skip)
manifest=read(OUTPUT/'manifest.json');manifest.update({'version':'ecdict-phrases-1300-v2','baseCount':len(base),'count':len({entry['id'] for entry in base}|set(selected)),'words':sum(entry['kind']=='word' for entry in base),'phrases':len(entries),'phraseBytes':len(raw),'phraseGzipBytes':len(gzip.compress(raw,mtime=0)),'phraseSha256':hashlib.sha256(raw).hexdigest(),'phraseCategories':dict(Counter(selected.values())),'phraseTags':dict(Counter(tag for entry in entries for tag in entry['tags'])),'phraseSourceMembership':{name:sum(entry['id'] in keys for entry in entries) for name,keys in lists.items()},'phraseSources':source_meta,'phraseLicense':'CC-BY-SA-4.0','phraseExcludedCount':len(skip),'legacyPhrasesPreserved':len(legacy)})
(OUTPUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({key:manifest[key] for key in ['count','words','phrases','phraseBytes','phraseGzipBytes','phraseCategories','phraseTags','phraseExcludedCount']},ensure_ascii=False,indent=2))
