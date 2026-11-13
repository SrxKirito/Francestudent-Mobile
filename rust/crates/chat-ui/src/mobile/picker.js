(() => {
    if (globalThis.frstAttachmentPicker) return;
    let nextId = 0;
    let selection = { files: [], rejected: [] };
    const files = new Map();
    const isPicker = (element) => element instanceof HTMLInputElement
        && element.type === "file" && element.dataset.frstAttachments === "true";

    // Wry already presents the system dialog. Keep Dioxus from replacing it with
    // its desktop picker, and forward only metadata to Rust at selection time.
    addEventListener("click", (event) => {
        if (isPicker(event.target)) event.stopImmediatePropagation();
    }, true);
    addEventListener("input", (event) => {
        if (isPicker(event.target)) event.stopImmediatePropagation();
    }, true);
    addEventListener("change", (event) => {
        const input = event.target;
        if (!isPicker(input)) return;
        event.stopImmediatePropagation();
        const receiver = input.closest(".composer-attachments")?.querySelector(".attachment-receiver");
        if (!receiver) return;
        const max = Number(input.dataset.maxBytes);
        for (const file of input.files ?? []) {
            if (file.size > max) {
                selection.rejected.push(file.name);
                continue;
            }
            const id = ++nextId;
            files.set(id, { original: file, converted: null });
            selection.files.push({ id, name: file.name, size: file.size, type: file.type });
        }
        input.value = "";
        receiver.click();
    }, true);

    globalThis.frstAttachmentPicker = {
        take() {
            const taken = selection;
            selection = { files: [], rejected: [] };
            return taken;
        },
        async chunk(id, start, end, converted) {
            const entry = files.get(id);
            const file = converted ? entry?.converted : entry?.original;
            if (!file || start < 0 || end < start || end > file.size || end - start > 48 * 1024) {
                return { data: null };
            }
            try {
                const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
                let raw = "";
                for (let offset = 0; offset < bytes.length; offset += 8192) {
                    raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
                }
                return { data: btoa(raw) };
            } catch {
                return { data: null };
            }
        },
        async convertImage(id, maxSize) {
            const entry = files.get(id);
            const file = entry?.original;
            if (!file || file.size > maxSize) return null;
            if (entry.converted) {
                const jpeg = entry.converted;
                return { name: jpeg.name, size: jpeg.size, type: jpeg.type };
            }
            const url = URL.createObjectURL(file);
            const image = new Image();
            let canvas;
            try {
                await new Promise((resolve, reject) => {
                    image.onload = resolve;
                    image.onerror = reject;
                    image.src = url;
                });
                const width = image.naturalWidth;
                const height = image.naturalHeight;
                if (!width || !height) return null;
                const scale = Math.min(1, 2048 / Math.max(width, height));
                canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(width * scale));
                canvas.height = Math.max(1, Math.round(height * scale));
                const context = canvas.getContext("2d");
                if (!context) return null;
                context.fillStyle = "#fff";
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                const jpeg = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
                if (!jpeg || jpeg.type !== "image/jpeg" || jpeg.size > maxSize) return null;
                const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
                entry.converted = new File([jpeg], name, { type: jpeg.type });
                return { name, size: jpeg.size, type: jpeg.type };
            } catch {
                return null;
            } finally {
                if (canvas) canvas.width = canvas.height = 0;
                URL.revokeObjectURL(url);
            }
        },
        release(ids) {
            for (const id of ids) files.delete(id);
        }
    };
})();
