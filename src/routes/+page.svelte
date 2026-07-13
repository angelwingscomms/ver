<script lang="ts">
	import { BOOKS } from '$lib/books';
	let q = $state('');
	let b = $state('');
	let x = $state<number | ''>('');
	let mode = $state<'chapters' | 'verses'>('chapters');
	let r = $state<{ b: string; c: number; v?: number; t: string; s: number }[]>([]);
	type SR = { r?: { b: string; c: number; v?: number; t: string; s: number }[]; message?: string };
	let loading = $state(false);
	let msg = $state('');

	async function search() {
		if (!q.trim()) return;
		loading = true;
		msg = '';
		try {
			const p = new URLSearchParams();
			p.set('q', q);
			if (b) p.set('b', b);
			if (x !== '') p.set('x', String(x));
			p.set(mode === 'verses' ? 'v' : 'c', '');
			const res = await fetch(`/api/search?${p.toString()}`);
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
		<div class="toggle" role="tablist" aria-label="Search scope">
			<button
				type="button"
				role="tab"
				aria-selected={mode === 'verses'}
				class:on={mode === 'verses'}
				onclick={() => (mode = 'verses')}
			>
				Search verses
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={mode === 'chapters'}
				class:on={mode === 'chapters'}
				onclick={() => (mode = 'chapters')}
			>
				Search chapters
			</button>
		</div>
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
			<input type="number" placeholder="Ch." bind:value={x} min="1" aria-label="Chapter" />
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
			<details class="hit">
				<summary>
					<span class="ref">{hit.b} <span class="ch">{hit.c}{typeof hit.v === 'number' ? `:${hit.v}` : ''}</span></span>
					<span class="right">
						<span class="score">{hit.s.toFixed(3)}</span>
						<span class="chev"></span>
					</span>
				</summary>
				<p class="text">{hit.t}</p>
			</details>
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
		color: #1e40af;
		margin: 0 0 0.6rem;
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
	}
	h1 {
		font-size: clamp(2.2rem, 6vw, 3.2rem);
		font-weight: 600;
		margin: 0;
		letter-spacing: -0.01em;
		color: #16233f;
	}
	.lede {
		margin: 0.75rem auto 0;
		max-width: 30rem;
		color: #475569;
		font-size: 1.05rem;
		line-height: 1.5;
	}

	.toggle {
		display: inline-flex;
		margin: 1.8rem auto 0;
		padding: 0.28rem;
		background: #eef2f9;
		border: 1px solid #dbe3f0;
		border-radius: 999px;
		gap: 0.25rem;
	}
	.toggle button {
		height: 2.3rem;
		padding: 0 1.15rem;
		font-size: 0.9rem;
		font-weight: 600;
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		color: #64748b;
		background: transparent;
		border: none;
		border-radius: 999px;
		cursor: pointer;
		transition:
			background 0.18s ease,
			color 0.18s ease,
			box-shadow 0.18s ease;
	}
	.toggle button:hover:not(.on) {
		color: #1e40af;
	}
	.toggle button.on {
		color: #fff;
		background: #1d4ed8;
		box-shadow: 0 6px 16px -10px rgba(29, 78, 216, 0.8);
	}

	form {
		display: grid;
		grid-template-columns: 1fr auto auto auto;
		gap: 0.6rem;
		background: #ffffff;
		padding: 0.7rem;
		border: 1px solid #dbe3f0;
		border-radius: 14px;
		box-shadow: 0 1px 2px rgba(22, 35, 63, 0.04), 0 12px 30px -18px rgba(22, 35, 63, 0.25);
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
		color: #16233f;
		background: #f4f7fc;
		border: 1px solid #dbe3f0;
		border-radius: 9px;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease,
			background 0.15s ease;
	}
	input::placeholder {
		color: #9aa6bb;
	}
	input:focus,
	select:focus {
		outline: none;
		background: #fff;
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
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
		background: #1d4ed8;
		border: none;
		border-radius: 9px;
		cursor: pointer;
		transition:
			background 0.15s ease,
			transform 0.05s ease;
	}
	button:hover:not(:disabled) {
		background: #1e40af;
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
		color: #1d4ed8;
		margin: 1.6rem 0 0;
		font-size: 0.98rem;
	}
	.msg.muted {
		color: #94a3b8;
	}

	.results {
		margin-top: 2.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.hit {
		background: #ffffff;
		border: 1px solid #e4e9f2;
		border-radius: 12px;
		overflow: hidden;
		transition:
			box-shadow 0.18s ease,
			border-color 0.18s ease;
	}
	.hit[open] {
		border-color: #c3d0ea;
		box-shadow: 0 10px 26px -20px rgba(22, 35, 63, 0.45);
	}
	.hit summary {
		list-style: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1.1rem 1.25rem;
	}
	.hit summary::-webkit-details-marker {
		display: none;
	}
	.hit summary:focus-visible {
		outline: 2px solid #2563eb;
		outline-offset: -2px;
		border-radius: 12px;
	}
	.right {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}
	.chev {
		width: 0.5rem;
		height: 0.5rem;
		border-right: 2px solid #94a3b8;
		border-bottom: 2px solid #94a3b8;
		transform: rotate(45deg);
		transition: transform 0.2s ease;
		flex: none;
	}
	.hit[open] .chev {
		transform: rotate(-135deg);
	}
	.ref {
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		font-weight: 600;
		font-size: 0.92rem;
		letter-spacing: 0.01em;
		color: #1e40af;
	}
	.ch {
		color: #3b82f6;
		font-weight: 600;
	}
	.score {
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		font-size: 0.72rem;
		color: #94a3b8;
		background: #e8eefb;
		border-radius: 999px;
		padding: 0.15rem 0.55rem;
		white-space: nowrap;
	}
	.text {
		margin: 0;
		padding: 0 1.25rem 1.1rem;
		white-space: pre-wrap;
		line-height: 1.65;
		font-size: 1.05rem;
		color: #1e293b;
	}

	footer {
		margin-top: 2.5rem;
		text-align: center;
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		font-size: 0.78rem;
		letter-spacing: 0.03em;
		color: #94a3b8;
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
