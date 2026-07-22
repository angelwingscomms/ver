import json, os, time, uuid, requests
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue, PayloadSchemaType

# load keys from ../e4/.env
env = {}
with open(os.path.expanduser('~/i/e4/.env')) as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k] = v

QDRANT_URL = env['QDRANT_URL']
QDRANT_KEY = env['QDRANT_KEY']
VOXELL_KEY = env['VOXELL_KEY']
MODEL = 'jcorners/ingot-8b-r3'
COLLECTION = 'bible'
TENANT = 'ylt2'
BATCH = 20
NS = uuid.UUID('11111111-2222-3333-4444-555555555555')

qc = QdrantClient(url=QDRANT_URL, api_key=QDRANT_KEY, timeout=120)

if not qc.collection_exists(COLLECTION):
    qc.create_collection(COLLECTION, vectors_config=VectorParams(size=4096, distance=Distance.COSINE))
    qc.create_payload_index(COLLECTION, 's', PayloadSchemaType.KEYWORD)
    qc.create_payload_index(COLLECTION, 'b', PayloadSchemaType.KEYWORD)
    qc.create_payload_index(COLLECTION, 'c', PayloadSchemaType.INTEGER)

tenant_filter = Filter(must=[FieldCondition(key='s', match=MatchValue(value=TENANT))])
done = qc.count(COLLECTION, count_filter=tenant_filter).count
print('collection ready:', COLLECTION, '| tenant', TENANT, '| already', done)

d = json.load(open(os.path.expanduser('~/i/ver/ylt.json')))

# build chapter records: (book, chapter, text)
recs = []
for bk in d['books']:
    for ch in bk['chapters']:
        text = '\n'.join(v['text'] for v in ch['verses'])
        recs.append((bk['name'], ch['chapter'], text))
print('total chapters:', len(recs))


def embed(texts):
    for attempt in range(4):
        try:
            r = requests.post('https://api.voxell.ai/v1/embeddings',
                              headers={'Authorization': f'Bearer {VOXELL_KEY}', 'Content-Type': 'application/json'},
                              json={'model': MODEL, 'input': texts}, timeout=90)
            r.raise_for_status()
            data = r.json()['data']
            data.sort(key=lambda x: x['index'])
            return [x['embedding'] for x in data]
        except Exception as e:
            print('embed retry', attempt, e)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError('embed failed')


def upsert_pts(pts):
    for attempt in range(5):
        try:
            qc.upsert(COLLECTION, points=pts, wait=True)
            return
        except Exception as e:
            print('upsert retry', attempt, e)
            time.sleep(3 * (attempt + 1))


n = 0
for i in range(0, len(recs), BATCH):
    chunk = recs[i:i + BATCH]
    ids = [str(uuid.uuid5(NS, f'{TENANT}:{book}:{ch}')) for book, ch, _ in chunk]
    texts = [c[2] for c in chunk]
    vecs = embed(texts)
    pts = [PointStruct(id=pid, vector=vec, payload={'s': TENANT, 'b': book, 'c': ch, 't': text})
           for pid, (book, ch, text), vec in zip(ids, chunk, vecs)]
    upsert_pts(pts)
    n += len(pts)
    print(f'upserted {n}/{len(recs)}')

print('DONE. tenant points:', qc.count(COLLECTION, count_filter=tenant_filter).count)
