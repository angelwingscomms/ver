<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		background: #f6f1e9;
		color: #2b2622;
		font-family:
			'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
		-webkit-font-smoothing: antialiased;
		text-rendering: optimizeLegibility;
	}
	:global(*) {
		box-sizing: border-box;
	}
	:global(a) {
		color: #9a6a4f;
	}
</style>

{@render children()}
