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
		background: #f3f6fb;
		color: #16233f;
		font-family:
			system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
		-webkit-font-smoothing: antialiased;
		text-rendering: optimizeLegibility;
	}
	:global(*) {
		box-sizing: border-box;
	}
	:global(a) {
		color: #1d4ed8;
	}
</style>

{@render children()}
