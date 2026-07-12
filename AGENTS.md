# Rules for Bible Search webapp

## Code Style
- Naming: always snake_case for vars/functions; make db payload, type defs, request JSON and page load return value keys always single letters.
- DB/Qdrant: Multi-tenancy, single collection 'i'; tenant-id on payload field `s`. For now collection 'bible' used.
- Conciseness: no vars for single-use; code minimally
- never start the dev server
- fonts go in static/fonts

## Env
- QDRANT_URL, QDRANT_KEY, OPENROUTER_KEY from ~/i/e4/.env
