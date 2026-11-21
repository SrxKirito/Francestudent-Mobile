<script lang="ts">
  const paths = {
    folder: "M3 7V5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    image: "M4 4h16v16H4z M8 9h.01 M4 16l5-4 4 3 3-3 4 4",
    file: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
    archive: "M4 7h16v13H4z M3 4h18v3H3z M10 11h4",
    skills: "M12 3l8 4v10l-8 4-8-4V7z M4 7l8 4 8-4 M12 11v10",
    edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    back: "M20 12H4 M11 5l-7 7 7 7",
    next: "M9 5l7 7-7 7",
    refresh: "M20 8a8 8 0 0 0-14-2L3 9 M3 4v5h5 M4 16a8 8 0 0 0 14 2l3-3 M21 20v-5h-5",
    download: "M12 3v12 M7 10l5 5 5-5 M4 16v4h16v-4",
    trash: "M3 6h18 M8 6V3h8v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7"
  };
  let { name, size = 20 }: { name: keyof typeof paths; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name]} />
</svg>
