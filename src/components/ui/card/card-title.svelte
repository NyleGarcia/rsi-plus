<script lang="ts">
	import { cn, type WithElementRef } from "@/lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		level = 3,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> & {
		/** Heading level — the hub header already renders the page's <h2>, so a card title defaults to <h3>; 0 = plain div. */
		level?: 0 | 2 | 3 | 4;
	} = $props();
</script>

<svelte:element
	this={level ? `h${level}` : "div"}
	bind:this={ref}
	data-slot="card-title"
	class={cn("m-0 text-lg leading-snug font-semibold group-data-[size=sm]/card:text-sm", className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
