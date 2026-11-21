<script lang="ts">
  let { name }: { name: string } = $props();

  const artwork = {
    pdf: "M8 12h8M8 15h6M8 18h4",
    document: "M8 11h8M8 14h8M8 17h5",
    sheet: "M8 11h8v7H8z M8 14.5h8M12 11v7",
    slides: "M8 11h8v5H8z M12 16v3M10 19h4",
    image: "M8 11h8v7H8z M10.2 13h.01M8 17l2.7-2.5 2 1.5 1.6-1.5L16 16",
    code: "M10 12l-2 2 2 2m4-4 2 2-2 2m-1.1-5-1.8 6",
    archive: "M11 10h2m-2 2h2m-2 2h2m-2 2h2v2h-2z",
    audio: "M11 17v-5l5-1v5M11 17c0 1-2 1-2 0s2-1 2 0m5-1c0 1-2 1-2 0s2-1 2 0",
    video: "M8 11h8v7H8z M11 13l3 1.5-3 1.5z",
  };

  const formats: { kind: keyof typeof artwork; extensions: RegExp }[] = [
    { kind: "pdf", extensions: /^pdf$/ },
    { kind: "sheet", extensions: /^(xlsx?|csv|tsv|ods)$/ },
    { kind: "slides", extensions: /^(pptx?|odp|key)$/ },
    { kind: "image", extensions: /^(png|jpe?g|gif|webp|svg|bmp|tiff?|avif|heic)$/ },
    { kind: "code", extensions: /^(html?|css|jsx?|tsx?|mjs|json|xml|ya?ml|py|sh|sql|rs|go|c|cpp|java|swift|kt|php|rb)$/ },
    { kind: "archive", extensions: /^(zip|rar|7z|tar|gz)$/ },
    { kind: "audio", extensions: /^(mp3|wav|ogg|m4a|flac|aac)$/ },
    { kind: "video", extensions: /^(mp4|mov|mpeg|webm|avi)$/ },
  ];
  const extension = $derived(/\.([a-z0-9]{1,8})$/i.exec(name)?.[1].toLowerCase() ?? "");
  const kind = $derived(formats.find(format => format.extensions.test(extension))?.kind ?? "document");
</script>

<span class="file-format-preview" data-kind={kind} data-extension={extension.toUpperCase() || "FILE"} aria-hidden="true">
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false">
    <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm7 0v4h4"/>
    <path d={artwork[kind]}/>
  </svg>
</span>

<style>
  .file-format-preview {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 1px;
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    border-radius: .55rem;
    color: #2c5794;
    background: #e8f1fd;
  }

  .file-format-preview::after {
    content: attr(data-extension);
    font-size: .49rem;
    line-height: 1;
    font-weight: 700;
  }

  [data-kind=pdf] { color: #a42836; background: #fbe8ea; }
  [data-kind=sheet] { color: #17654a; background: #def4e9; }
  [data-kind=slides] { color: #953f0e; background: #ffeddc; }
  [data-kind=image], [data-kind=video] { color: #653b9b; background: #f0e8fc; }
  [data-kind=code] { color: #096270; background: #dff3f7; }
  [data-kind=archive] { color: #6e520f; background: #f9efcd; }
  [data-kind=audio] { color: #9a284f; background: #f9e5ee; }
</style>
