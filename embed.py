import json, os, time, requests
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

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
OR_KEY = env['OPENROUTER_KEY']
MODEL = 'qwen/qwen3-embedding-8b'
COLLECTION = 'bible'
TENANT = 'ylt'
BATCH = 20

qc = QdrantClient(url=QDRANT_URL, api_key=QDRANT_KEY, timeout=120)

# create collection if missing (resumable: keep existing points)
if not qc.collection_exists(COLLECTION):
    qc.create_collection(COLLECTION, vectors_config=VectorParams(size=4096, distance=Distance.COSINE))
done = qc.count(COLLECTION).count
print('collection ready:', COLLECTION, '| already', done)

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
            r = requests.post('https://openrouter.ai/api/v1/embeddings',
                              headers={'Authorization': f'Bearer {OR_KEY}', 'Content-Type': 'application/json'},
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


n = done
recs = recs[done:]
print('resuming from', done, '| remaining', len(recs))
for i in range(0, len(recs), BATCH):
    chunk = recs[i:i + BATCH]
    texts = [c[2] for c in chunk]
    vecs = embed(texts)
    pts = []
    for (book, ch, text), vec in zip(chunk, vecs):
        n += 1
        pts.append(PointStruct(id=n, vector=vec,
                     payload={'s': TENANT, 'b': book, 'c': ch, 't': text}))
    upsert_pts(pts)
    print(f'upserted {n}/{len(recs) + done}')

print('DONE. points:', qc.count(COLLECTION).count)
