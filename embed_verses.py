import json, os, re, time, uuid, requests
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, PayloadSchemaType, Filter, FieldCondition, MatchValue

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
COLLECTION = 'verses'
TENANT = 'ylt2'
BATCH = 1000
NS = uuid.UUID('11111111-2222-3333-4444-555555555555')

qc = QdrantClient(url=QDRANT_URL, api_key=QDRANT_KEY, timeout=600, prefer_grpc=True)
if not qc.collection_exists(COLLECTION):
    qc.create_collection(COLLECTION, vectors_config=VectorParams(size=4096, distance=Distance.COSINE))
    qc.create_payload_index(COLLECTION, 's', PayloadSchemaType.KEYWORD)
    qc.create_payload_index(COLLECTION, 'b', PayloadSchemaType.KEYWORD)
    qc.create_payload_index(COLLECTION, 'c', PayloadSchemaType.INTEGER)
    qc.create_payload_index(COLLECTION, 'v', PayloadSchemaType.INTEGER)

d = json.load(open(os.path.expanduser('~/i/ver/ylt.json')))
recs = []
for bk in d['books']:
    for ch in bk['chapters']:
        for v in ch['verses']:
            text = re.sub(r'<[^>]+>', '', v['text']).strip()
            recs.append((bk['name'], v['chapter'], v['verse'], text))
print('total verses:', len(recs))

tenant_filter = Filter(must=[FieldCondition(key='s', match=MatchValue(value=TENANT))])
done = qc.count(COLLECTION, count_filter=tenant_filter).count
recs = recs[done:]
n = done
print('resuming from', done, '| remaining', len(recs))


def embed(texts):
    for attempt in range(4):
        try:
            r = requests.post('https://api.voxell.ai/v1/embeddings',
                              headers={'Authorization': f'Bearer {VOXELL_KEY}', 'Content-Type': 'application/json'},
                              json={'model': MODEL, 'input': texts}, timeout=120)
            r.raise_for_status()
            data = r.json()['data']
            data.sort(key=lambda x: x['index'])
            return [x['embedding'] for x in data]
        except Exception as e:
            print('embed retry', attempt, e)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError('embed failed')


idx = 0
while idx < len(recs):
    chunk = recs[idx:idx + BATCH]
    vecs = embed([c[3] for c in chunk])
    ids = [str(uuid.uuid5(NS, f'{TENANT}:{b}:{c}:{v}')) for b, c, v, _ in chunk]
    pts = [PointStruct(id=ids[j], vector=vecs[j],
            payload={'s': TENANT, 'b': chunk[j][0], 'c': chunk[j][1], 'v': chunk[j][2], 't': chunk[j][3]})
           for j in range(len(chunk))]
    ok = False
    for attempt in range(8):
        try:
            qc.upsert(COLLECTION, points=pts, wait=True)
            ok = True
            break
        except Exception as e:
            print('upsert retry', attempt, e)
            time.sleep(4 * (attempt + 1))
    if not ok:
        print('ABORT batch failed')
        break
    n += len(chunk)
    idx += BATCH
    if n % 500 == 0 or idx >= len(recs):
        print(f'upserted {n}/{len(recs) + done}')

print('DONE. tenant points:', qc.count(COLLECTION, count_filter=tenant_filter).count)
