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

<svelte:head>
	<title>YLT Bible Search</title>
	<meta
		name="description"
		content="Semantic search across the Bible (Young's Literal Translation)."
	/>
</svelte:head>

<main>
	<header class="hero">
		<p class="kicker">Young's Literal Translation</p>
		<h1>Bible Search</h1>
		<p class="lede">
			Ask in plain language and find the passage by meaning — not just by keyword.
		</p>
	</header>

	<form onsubmit={(e) => { e.preventDefault(); search(); }}>
		<div class="field q">
			<input
				placeholder="search the Bible…  e.g. God so loved the world"
				bind:value={q}
				aria-label="Search query"
			/>
		</div>
		<div class="field b">
			<select bind:value={b} aria-label="Book">
				<option value="">All books</option>
				{#each BOOKS as book}
					<option value={book}>{book}</option>
				{/each}
			</select>
		</div>
		<div class="field c">
			<input type="number" placeholder="Ch." bind:value={c} min="1" aria-label="Chapter" />
		</div>
		<button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
	</form>

	{#if msg && !loading}
		<p class="msg">{msg}</p>
	{:else if loading}
		<p class="msg muted">Searching…</p>
	{/if}

	<section class="results">
		{#each r as hit}
			<article>
				<header>
					<span class="ref">{hit.b} <span class="ch">{hit.c}</span></span>
					<span class="score">{hit.s.toFixed(3)}</span>
				</header>
				<p class="text">{hit.t}</p>
			</article>
		{/each}
	</section>

	<footer>
		Semantic search · {r.length ? `${r.length} result${r.length > 1 ? 's' : ''}` : 'open to all'}
	</footer>
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 4rem 1.25rem 5rem;
	}

	.hero {
		text-align: center;
		margin-bottom: 2.5rem;
	}
	.kicker {
		text-transform: uppercase;
		letter-spacing: 0.22em;
		font-size: 0.7rem;
		color: #a9744f;
		margin: 0 0 0.6rem;
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
	}
	h1 {
		font-size: clamp(2.2rem, 6vw, 3.2rem);
		font-weight: 600;
		margin: 0;
		letter-spacing: -0.01em;
		color: #2b2622;
	}
	.lede {
		margin: 0.75rem auto 0;
		max-width: 30rem;
		color: #756a5e;
		font-size: 1.05rem;
		line-height: 1.5;
	}

	form {
		display: grid;
		grid-template-columns: 1fr auto auto auto;
		gap: 0.6rem;
		background: #fffdf9;
		padding: 0.7rem;
		border: 1px solid #e7ddcd;
		border-radius: 14px;
		box-shadow: 0 1px 2px rgba(43, 38, 34, 0.04), 0 12px 30px -18px rgba(43, 38, 34, 0.25);
	}
	.field {
		min-width: 0;
	}
	.field.b,
	.field.c {
		width: auto;
	}
	input,
	select {
		width: 100%;
		height: 3rem;
		padding: 0 0.9rem;
		font-size: 1rem;
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		color: #2b2622;
		background: #fbf7f0;
		border: 1px solid #e7ddcd;
		border-radius: 9px;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease,
			background 0.15s ease;
	}
	input::placeholder {
		color: #b3a896;
	}
	input:focus,
	select:focus {
		outline: none;
		background: #fff;
		border-color: #c9a884;
		box-shadow: 0 0 0 3px rgba(169, 116, 79, 0.15);
	}
	.field.c input {
		width: 5rem;
		text-align: center;
	}
	select {
		cursor: pointer;
		padding-right: 2rem;
	}
	button {
		height: 3rem;
		padding: 0 1.4rem;
		font-size: 1rem;
		font-weight: 600;
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		color: #fff;
		background: #9a6a4f;
		border: none;
		border-radius: 9px;
		cursor: pointer;
		transition:
			background 0.15s ease,
			transform 0.05s ease;
	}
	button:hover:not(:disabled) {
		background: #875c44;
	}
	button:active:not(:disabled) {
		transform: translateY(1px);
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.msg {
		text-align: center;
		color: #9a6a4f;
		margin: 1.6rem 0 0;
		font-size: 0.98rem;
	}
	.msg.muted {
		color: #b3a896;
	}

	.results {
		margin-top: 2.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	article {
		background: #fffdf9;
		border: 1px solid #ece2d2;
		border-radius: 12px;
		padding: 1.1rem 1.25rem;
		transition:
			box-shadow 0.18s ease,
			border-color 0.18s ease,
			transform 0.18s ease;
	}
	article:hover {
		border-color: #d9c4a8;
		box-shadow: 0 10px 26px -20px rgba(43, 38, 34, 0.5);
		transform: translateY(-1px);
	}
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.55rem;
	}
	.ref {
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		font-weight: 600;
		font-size: 0.92rem;
		letter-spacing: 0.01em;
		color: #9a6a4f;
	}
	.ch {
		color: #b58a6a;
		font-weight: 600;
	}
	.score {
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		font-size: 0.72rem;
		color: #b3a896;
		background: #f3ebdd;
		border-radius: 999px;
		padding: 0.15rem 0.55rem;
		white-space: nowrap;
	}
	.text {
		margin: 0;
		white-space: pre-wrap;
		line-height: 1.65;
		font-size: 1.05rem;
		color: #38312b;
	}

	footer {
		margin-top: 2.5rem;
		text-align: center;
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		font-size: 0.78rem;
		letter-spacing: 0.03em;
		color: #b3a896;
	}

	@media (max-width: 620px) {
		form {
			grid-template-columns: 1fr 1fr;
		}
		.field.q {
			grid-column: 1 / -1;
		}
		button {
			grid-column: 1 / -1;
		}
	}
</style>
