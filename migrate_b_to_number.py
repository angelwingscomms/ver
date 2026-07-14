import json, os
from qdrant_client import QdrantClient
from qdrant_client.models import PayloadSchemaType

env = {}
with open(os.path.expanduser('~/i/e4/.env')) as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k] = v

qc = QdrantClient(url=env['QDRANT_URL'], api_key=env['QDRANT_KEY'], timeout=600, prefer_grpc=True)

d = json.load(open(os.path.expanduser('~/i/ver/ylt.json')))
name2num = {}
for i, bk in enumerate(d['books']):
    name2num[bk['name']] = i + 1
name2num['Song of Solomon'] = 22  # ylt uses 'Song of Songs'; alias to same number

COLS = ['verses', 'bible']


def migrate(col):
    by_num = {}
    unmapped = set()
    offset = None
    while True:
        pts, offset = qc.scroll(col, limit=2000, offset=offset, with_payload=['b'], with_vectors=False)
        if not pts:
            break
        for p in pts:
            cur = p.payload.get('b') if p.payload else None
            if isinstance(cur, int):
                continue
            num = name2num.get(cur)
            if num is None:
                unmapped.add(cur)
                continue
            by_num.setdefault(num, []).append(p.id)
        if offset is None:
            break
    for num, ids in by_num.items():
        qc.set_payload(col, payload={'b': num}, points=ids, wait=True)
    total = sum(len(v) for v in by_num.values())
    print(f'[{col}] updated {total} points across {len(by_num)} books; unmapped: {unmapped or "NONE"}')


for col in COLS:
    migrate(col)
    try:
        qc.delete_payload_index(col, 'b')
    except Exception as e:
        print(f'[{col}] delete index: {e}')
    qc.create_payload_index(col, 'b', PayloadSchemaType.INTEGER)
    print(f'[{col}] b index now INTEGER')

print('MIGRATION DONE')
