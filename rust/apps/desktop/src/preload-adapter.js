/* eslint-disable no-undef, no-unused-vars -- Ce gabarit reçoit le préchargement et ses constantes à la compilation Rust. */
(() => {
    "use strict";
    // Wry's document-start script also runs in subframes on Windows.
    if (window !== window.top || location.href !== __FRST_DOCUMENT__) return;
    const capability = __FRST_CAPABILITY__;
    const pending = new Map();
    const listeners = new Set();
    let sequence = 0;
    let backendError = null;

    function requestMotion(packet) {
        function finish(result) {
            window.ipc.postMessage(JSON.stringify({ ...result, kind: "motionReply", id: packet.id, capability }));
        }
        try {
            const base = new URL(packet.payload.url);
            const frame = document.querySelector(".motion-engine-iframe");
            const frameUrl = new URL(frame?.src);
            if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" ||
                frameUrl.origin !== base.origin || !frameUrl.pathname.startsWith(base.pathname) ||
                !frame?.contentWindow) throw new Error("Le moteur EffectCraft n’est pas encore chargé.");
            const channel = new MessageChannel();
            const timer = setTimeout(() => {
                channel.port1.close();
                finish({ ok: false, error: "EffectCraft n’a pas répondu en 30 secondes." });
            }, 30000);
            channel.port1.onmessage = event => {
                clearTimeout(timer);
                channel.port1.close();
                finish(event.data);
            };
            frame.contentWindow.postMessage({ type: "frst:effectcraft", request: packet.payload.request }, base.origin, [channel.port2]);
        } catch (error) {
            finish({ ok: false, error: error.message });
        }
    }

    function receive(json) {
        const packet = JSON.parse(json);
        if (packet.kind === "motion") return requestMotion(packet);
        if (packet.kind === "offline") {
            backendError = packet.error;
            for (const waiter of pending.values()) waiter.reject(new Error(backendError));
            pending.clear();
            return;
        }
        if (packet.kind === "event") {
            for (const listener of [...listeners]) {
                try { listener(null, packet); } catch (error) { console.error(error); }
            }
            return;
        }
        const waiter = pending.get(packet.id);
        if (packet.kind !== "reply" || !waiter) return;
        pending.delete(packet.id);
        waiter.resolve(packet);
    }
    Object.defineProperty(window, "__frstRustReceive", { value: receive });

    const ipcRenderer = {
        invoke(channel, ...args) {
            if (backendError) return Promise.reject(new Error(backendError));
            return new Promise((resolve, reject) => {
                const id = ++sequence;
                pending.set(id, { resolve, reject });
                try {
                    const body = JSON.stringify({ kind: "invoke", id, channel, args, capability });
                    if (new Blob([body]).size > 64 * 1024 * 1024) throw new Error("La demande dépasse la limite de transfert.");
                    window.ipc.postMessage(body);
                } catch (error) {
                    pending.delete(id);
                    reject(error);
                }
            });
        },
        on(channel, listener) { if (channel === "frst:event") listeners.add(listener); },
        removeListener(channel, listener) { if (channel === "frst:event") listeners.delete(listener); }
    };
    const contextBridge = {
        exposeInMainWorld(name, value) {
            Object.defineProperty(window, name, { value: Object.freeze(value) });
        }
    };
    const process = { platform: __FRST_PLATFORM__ };

    __FRST_PRELOAD__
})();
