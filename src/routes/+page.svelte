<script lang="ts">
	import { BOOKS } from '$lib/books';
	let q = $state('');
	let b = $state('');
	let c = $state<number | ''>('');
	let r = $state<{ b: string; c: number; t: string; s: number }[]>([]);
	type SR = { r?: { b: string; c: number; t: string; s: number }[] };
	let loading = $state(false);
	let msg = $state('');

	async function search() {
		if (!q.trim()) return;
		loading = true;
		msg = '';
		try {
			const res = await fetch('/api/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ q, b: b || undefined, c: c === '' ? undefined : Number(c) })
			});
			const d = (await res.json()) as SR;
			if (!res.ok) {
				msg = d.message ?? 'search failed';
				r = [];
			} else {
				r = d.r ?? [];
				msg = r.length ? '' : 'no results';
			}
		} catch {
			msg = 'search failed';
		} finally {
			loading = false;
		}
	}
</script>

<main>
	<h1>YLT Bible Search</h1>
	<form onsubmit={(e) => { e.preventDefault(); search(); }}>
		<input placeholder="search the Bible…" bind:value={q} />
		<select bind:value={b}>
			<option value="">All books</option>
			{#each BOOKS as book}
				<option value={book}>{book}</option>
			{/each}
		</select>
		<input type="number" placeholder="chapter" bind:value={c} min="1" />
		<button type="submit" disabled={loading}>{loading ? '…' : 'Search'}</button>
	</form>

	{#if msg}<p class="msg">{msg}</p>{/if}

	{#each r as hit}
		<article>
			<header><strong>{hit.b}</strong> {hit.c} <span class="score">{hit.s.toFixed(3)}</span></header>
			<p class="text">{hit.t}</p>
		</article>
	{/each}
</main>

<style>
	main {
		max-width: 720px;
		margin: 2rem auto;
		padding: 0 1rem;
		font-family: Georgia, serif;
	}
	h1 {
		font-size: 1.6rem;
	}
	form {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1.5rem;
	}
	input,
	select {
		padding: 0.5rem;
		font-size: 1rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	input[placeholder='search the Bible…'] {
		flex: 1;
		min-width: 200px;
	}
	input[type='number'] {
		width: 90px;
	}
	button {
		padding: 0.5rem 1rem;
		font-size: 1rem;
		cursor: pointer;
	}
	.msg {
		color: #888;
	}
	article {
		border-top: 1px solid #eee;
		padding: 1rem 0;
	}
	header {
		font-size: 0.95rem;
		color: #555;
		margin-bottom: 0.4rem;
	}
	.score {
		color: #bbb;
		font-size: 0.8rem;
	}
	.text {
		white-space: pre-wrap;
		line-height: 1.5;
		margin: 0;
	}
</style>
