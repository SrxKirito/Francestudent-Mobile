"use strict";

// Reconnect only the currently visible interrupted conversation. Never send a
// new message: resumeSavedResponse uses GET /chats/{id}/stream and its cursor.
(() => {
  let resuming = false;
  async function resumeCurrentStream() {
    if (resuming || document.hidden || navigator.onLine === false || busy || !store.session) return;
    const conversation = (store.conversations || []).find(item => item.id === currentId);
    const pending = conversation?.pendingResponse;
    if (!pending || pending.state !== "interrupted" || !conversation.chatId) return;
    if (pending.owner && pending.owner !== store.profile?.email) return;
    if (typeof lockedChatIsHidden === "function" && lockedChatIsHidden(conversation)) return;
    if (!Number.isInteger(pending.userIndex) || pending.userIndex < 0 || !Array.isArray(conversation.messages)) return;
    if (conversation.messages.slice(pending.userIndex + 1).some(message => message.role === "user")) return;
    resuming = true;
    try { await resumeSavedResponse(conversation); }
    catch (error) { console.warn("Reprise du flux impossible", error); }
    finally { resuming = false; }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void resumeCurrentStream(); });
  window.addEventListener("online", () => { void resumeCurrentStream(); });
})();
