import type { ChatMessage, ChatOptionName, ChatSource, ChatState, PreviewTarget, StudyMode } from "../types/chat.ts";
import type { GeneratedImage, ProcessChatStreamOptions, StreamError, StreamEvent } from "../types/chat-stream.ts";
import { agentLabel } from "../utils/agents.ts";
import { STORE_KEY, patchStoredState } from "../utils/state.ts";
import type { StatePatch } from "../utils/state.ts";
import type { ApiClient } from "./api-client.ts";
import type { TokenProvider } from "./auth.ts";
import { EMPTY_CHAT_STATE, isHttpUrl } from "./chat-engine.ts";
import type { ChatEngine, ChatHost } from "./chat-engine.ts";
import { collectGeneratedImages, collectSourceUrls, friendlyError, generatedImageKey, processChatStream, resumeStreamPath } from "./chat-stream.ts";
import type { ShareRequest, ShareResult } from "./chat-shares.ts";
import type { ImportOutcome, ImportRequest } from "./conversation-import.ts";
import { canSaveCommonsImage, imageSearchQuery, normalizeCommonsImage } from "./image-search.ts";
import { safeFileName } from "./file-preview.ts";
import { saveBytes } from "./file-saver.ts";
import type { PreviewFile } from "./file-preview.ts";
import { CUSTOM_INSTRUCTIONS_MAX, FILE_INSTRUCTIONS, FILE_INSTRUCTIONS_TAG } from "./general-settings.ts";
import type { EngineAgent } from "./legacy-engine.ts";
import type { LocalSettingsGateway } from "./local-settings.ts";
import { createNativeAttachments } from "./native-chat-attachments.ts";
import { createNativeRequest } from "./native-chat-network.ts";
import type { NativeRequest } from "./native-chat-network.ts";
import { chatPrompt, isPowerPointPrompt } from "./native-chat-prompts.ts";
import { chatPath, detailMessages, matchingAnswer, messageText, recentChats, recoverChatId, waitUntilRetry } from "./native-chat-recovery.ts";
import type { NativeAttachment, NativePending } from "./native-chat-types.ts";
import type { NativeConversation, NativeConversations, NativeMessage } from "./native-conversations.ts";
import type { NativeFiles } from "./native-files.ts";
import type { PreviewStorage } from "./preview-storage.ts";
import { uploadFile } from "./transport.ts";

export interface NativeChatEngine extends ChatEngine {
  busy(): boolean;
  settingsChanged(): void;
  resume(id: string): Promise<void>;
  cancelPending(id: string): Promise<void>;
}

export interface NativeChatOptions {
  api: ApiClient;
  tokens: TokenProvider;
  repository: NativeConversations;
  local: LocalSettingsGateway;
  agents: () => readonly EngineAgent[];
  files: NativeFiles;
  previewStorage: PreviewStorage;
  openPreview(file: PreviewFile): void;
  noteUploaded?(response: unknown): void;
  notifyCompletion?(title: string): Promise<void>;
  request?: NativeRequest;
}

interface Generation {
  conversation: NativeConversation;
  pending: NativePending;
  controller: AbortController;
  stop: boolean;
  suspended: boolean;
  cancelResult?: Promise<boolean>;
  owner: string;
}

interface ComposerPreferences {
  agentId?: number;
  imageMode?: boolean;
  webSearch?: boolean;
  studyMode?: StudyMode;
  customInstructionsManaged?: boolean;
  fileInstrSynced?: boolean;
  profile?: { id?: number; email?: string };
}

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const INTERRUPTED = "La réponse a été interrompue. Reprends-la depuis la bibliothèque ou annule le suivi avant de renvoyer ton message.";
const IMAGE_BYTES = 20 * 1024 * 1024;
const RECOVERY_POLLS = 15;
const CANCEL_TIMEOUT = 8_000;

function readPreferences(): ComposerPreferences {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    return data && typeof data === "object" ? data : {};
  } catch { return {}; }
}

function writePreferences(patch: StatePatch) {
  try { localStorage.setItem(STORE_KEY, patchStoredState(localStorage.getItem(STORE_KEY), patch)); }
  catch { /* l’option active reste disponible */ }
}

function contextSummary(messages: NativeMessage[]): string {
  const lines: string[] = [];
  let length = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i];
    if (row.role === "error" || !row.content.trim()) continue;
    const line = (row.role === "assistant" ? "Assistant : " : "Utilisateur : ") + row.content.trim().slice(0, 1500);
    if (length + line.length > 8000) break;
    length += line.length;
    lines.unshift(line);
  }
  return lines.length ? "[Contexte de la conversation avant le changement]\n" + lines.join("\n\n") + "\n\n[Nouveau message]\n" : "";
}

function lastUser(messages: NativeMessage[], from = messages.length): number {
  for (let i = from - 1; i >= 0; i--) if (messages[i]?.role === "user") return i;
  return -1;
}

function imageForStorage(image: GeneratedImage): GeneratedImage | undefined {
  if (image.id && image.messageId && image.chatId) return { id: image.id, messageId: image.messageId, chatId: image.chatId };
  if (image.url) return { url: image.url };
  if (typeof image.data === "string" && image.data.length <= 1_500_000) return { data: image.data };
}

function storedImages(images: GeneratedImage[]): GeneratedImage[] {
  return images.map(imageForStorage).filter((image): image is GeneratedImage => image !== undefined);
}

function recoverablePending(conversation: NativeConversation, owner: string): NativePending | undefined {
  const pending = conversation.pendingResponse;
  if (pending && typeof pending === "object" && (pending.requestText || pending.text) &&
      Number.isInteger(pending.userIndex) && pending.userIndex === lastUser(conversation.messages) &&
      (!pending.owner || pending.owner.trim().toLowerCase() === owner.trim().toLowerCase())) return pending;
}

function fileContents(text: string, files: NativeAttachment[]): string {
  const fence = String.fromCharCode(96).repeat(3);
  return [text, ...files.filter(file => file.kind === "text" && file.data)
    .map(file => "Fichier joint : " + file.name + "\n" + fence + "\n" + file.data + "\n" + fence)].filter(Boolean).join("\n\n");
}

export function createNativeChatEngine(options: NativeChatOptions): NativeChatEngine {
  const { api, tokens, repository, local, agents, files } = options;
  const request = options.request ?? createNativeRequest(tokens);
  const prefs = readPreferences();
  let host: ChatHost | null = null;
  let unsubscribe: (() => void) | undefined;
  let lifetime = new AbortController();
  let active: Generation | null = null;
  let pendingCancellation = false;
  let activeAgent = prefs.agentId ?? null;
  let imageMode = prefs.imageMode === true;
  let webSearch = prefs.webSearch === true;
  let studyMode: StudyMode = prefs.studyMode === "fiches" || prefs.studyMode === "quiz" || prefs.studyMode === "cartes" ? prefs.studyMode : "";
  let powerpointMode = false;
  let draft = { seq: 0, text: "" };
  let edit: { id: string; index: number } | undefined;
  let carried: NativeAttachment[] = [];
  let currentId = repository.currentId();
  let imageSync = "";
  let fileInstructionsReady = false;
  const urls = new Map<string, Promise<string | null>>();
  const transientImages = new WeakMap<NativeMessage, GeneratedImage[]>();
  const voting = new WeakSet<NativeMessage>();
  const previousSourceUploads = new Map<string, string>();
  const changed = () => host?.changed();
  const toast = (message: string, error = false) => host?.toast(message, error);
  const attachments = createNativeAttachments({
    tokens, files, previewStorage: options.previewStorage, noteUploaded: options.noteUploaded, changed, toast
  });

  function models() {
    return agents().filter(agent => agent.available);
  }

  function pickedAgent(): EngineAgent | undefined {
    const catalog = models();
    return catalog.find(agent => agent.id === activeAgent) ?? catalog.find(agent => agent.id === local.read().defaultAgentId) ??
      catalog.find(agent => agent.isDefault) ?? catalog[0];
  }

  function canUse(conversation: NativeConversation | undefined): conversation is NativeConversation {
    return Boolean(conversation && !conversation.serverLocked && !conversation.serverArchived && !repository.isArchived(conversation.id));
  }

  function repoChanged() {
    const id = repository.currentId();
    if (id !== currentId) {
      currentId = id;
      if (edit?.id !== id) {
        edit = undefined;
        carried = [];
        draft = { seq: draft.seq + 1, text: "" };
      }
      const choice = repository.current()?.agentId ?? local.read().defaultAgentId;
      if (choice !== null && agents().some(item => item.id === choice && item.available)) activeAgent = choice;
    }
    changed();
  }

  function displayMessage(message: NativeMessage, index: number): ChatMessage {
    const images = transientImages.get(message) ?? message.images;
    return {
      index, role: message.role, content: message.content, feedback: message.feedback,
      serverMessageId: message.serverMessageId, sources: message.sources, imageSearch: message.imageSearch,
      attachments: message.attachments?.map(file => ({ name: file.name, kind: file.kind, mime: file.mime ?? "" })),
      images: images?.map((image, position) => ({
        index: position, id: image.id, messageId: image.messageId ?? undefined, chatId: image.chatId ?? undefined,
        url: image.url, inline: Boolean(image.data)
      }))
    };
  }

  function state(): ChatState {
    const candidate = repository.current();
    const conversation = canUse(candidate) ? candidate : undefined;
    const prefs = local.read();
    return {
      ...EMPTY_CHAT_STATE, ready: Boolean(host), id: conversation?.id ?? null,
      chatId: conversation?.chatId ?? null, title: conversation?.title ?? "", busy: Boolean(active) || pendingCancellation,
      stopping: active?.stop === true, pending: Boolean(conversation?.pendingResponse),
      conversationAgent: conversation && conversation.agentId !== undefined ? {
        id: conversation.agentId, name: conversation.agentName ?? "", provider: conversation.agentProvider ?? ""
      } : null,
      messages: conversation?.messages.map(displayMessage) ?? [],
      composer: {
        agentId: pickedAgent()?.id ?? null, webSearch, webSearchMode: prefs.webSearchMode, imageMode, powerpointMode,
        studyMode, imageModel: prefs.imageModel,
        attachments: [...carried.map(({ id, name, kind }) => ({ id, name, kind })), ...attachments.snapshot()]
      },
      draft
    };
  }

  async function syncInstructions(task: Generation) {
    const prefs = local.read();
    const wanted = task.pending.imageMode === true || prefs.imageTool;
    const key = wanted ? "on:" + prefs.imageModel : "off";
    const persisted = readPreferences();
    const fileRules = !fileInstructionsReady && !persisted.customInstructionsManaged && !persisted.fileInstrSynced;
    const imageRules = task.pending.imageMode === true || imageSync !== key;
    if (!fileRules && !imageRules) return;
    const signal = task.controller.signal;
    try {
      const current = await api.json<{
        customInstructions?: unknown; imageGenerationToolEnabled?: boolean; imageGenerationModel?: string;
      }>("/user/instructions", { signal });
      if (!current || typeof current !== "object") return;
      const patch: Record<string, unknown> = {};
      if (imageRules && (current.imageGenerationToolEnabled !== wanted || (wanted && current.imageGenerationModel !== prefs.imageModel))) {
        patch.imageGenerationToolEnabled = wanted;
        if (wanted && prefs.imageModel) patch.imageGenerationModel = prefs.imageModel;
      }
      const instructions = typeof current.customInstructions === "string" ? current.customInstructions : "";
      if (fileRules && !instructions.includes(FILE_INSTRUCTIONS_TAG)) {
        const value = [instructions, FILE_INSTRUCTIONS].filter(Boolean).join("\n\n");
        if (value.length <= CUSTOM_INSTRUCTIONS_MAX) patch.customInstructions = value;
      }
      if (Object.keys(patch).length) await api.json("/user/instructions", { method: "PATCH", body: patch, signal });
      signal.throwIfAborted();
      if (imageRules) imageSync = key;
      if (fileRules) {
        fileInstructionsReady = true;
        if ("customInstructions" in patch || instructions.includes(FILE_INSTRUCTIONS_TAG)) writePreferences({ fileInstrSynced: true });
      }
    } catch {
      if (!signal.aborted && task.pending.imageMode) toast("Impossible de synchroniser l’outil de génération d’image.", true);
    }
  }

  async function resolveImage(image: GeneratedImage): Promise<string | null> {
    if (image.url && isHttpUrl(image.url) && /^https:/i.test(image.url)) return image.url;
    if (image.data && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(image.data)) return image.data;
    const key = generatedImageKey(image);
    if (!key) return null;
    const cached = urls.get(key);
    if (cached) return cached;
    const signal = lifetime.signal;
    const operation = files.image(image, signal, IMAGE_BYTES).then(blob => {
      return signal.aborted ? null : URL.createObjectURL(blob);
    }).catch(() => {
      urls.delete(key);
      return null;
    });
    urls.set(key, operation);
    return operation;
  }

  async function previousImageSource(task: Generation, sent: NativeAttachment[]): Promise<string | undefined> {
    const text = task.pending.text || "";
    if (isPowerPointPrompt(text) || sent.some(file => file.kind === "image")) return;
    if (!task.pending.imageMode && !/\b(modifi|retouch|ajout|retir|change|am[ée]lior|modif|edit|replace)/i.test(text)) return;
    const previous = task.conversation.messages.slice(0, task.pending.userIndex).filter(message => message.role === "assistant").at(-1);
    const source = previous ? (transientImages.get(previous) ?? previous.images)?.at(-1) : undefined;
    if (!source) return;
    const key = generatedImageKey(source);
    const cached = key ? previousSourceUploads.get(key) : undefined;
    if (cached) return cached;
    const signal = task.controller.signal;
    try {
      const blob = await files.image(source, signal, IMAGE_BYTES);
      const extension = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1] || "png";
      const image = new File([blob], "image-precedente." + extension, { type: blob.type });
      const token = await tokens.getAccessToken();
      const result = await uploadFile(image, token, signal, () => {});
      const id = (result as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !id) return;
      options.noteUploaded?.(result);
      if (key) previousSourceUploads.set(key, id);
      return id;
    } catch { return undefined; }
  }

  function streamEvent(task: Generation, event: StreamEvent, images: GeneratedImage[], sources: ChatSource[]) {
    if (event.name === "image_start") task.pending.imageStarted = true;
    else if (event.name === "sources") {
      const seen = new Set(sources.map(source => source.url));
      for (const item of event.data) if (!seen.has(item.url)) {
        seen.add(item.url);
        sources.push(item);
      }
      task.pending.sources = sources;
    } else if (event.name === "image") {
      const image: GeneratedImage = {
        data: event.data.data ?? undefined, id: event.data.id ?? undefined,
        url: event.data.url ?? undefined, messageId: event.data.messageId, chatId: event.data.chatId
      };
      const key = generatedImageKey(image);
      if (key && !images.some(item => generatedImageKey(item) === key)) images.push(image);
      task.pending.images = storedImages(images);
    }
  }

  function received(task: Generation) {
    return !lifetime.signal.aborted && repository.owner() === task.owner &&
      repository.get(task.conversation.id) === task.conversation && task.conversation.pendingResponse === task.pending;
  }

  async function readStream(task: Generation, response: Response, resume: boolean, images: GeneratedImage[], sources: ChatSource[], saved: NativeMessage) {
    const { conversation, pending, controller } = task;
    const streamConversation = {
      get chatId() { return conversation.chatId ?? null; },
      set chatId(value: string | null) {
        if (value && UUID.test(value) && (!conversation.chatId || conversation.chatId === value)) conversation.chatId = value;
      },
      pendingResponse: pending
    };
    const args: ProcessChatStreamOptions = {
      response, conversation: streamConversation, resume, imageMode: pending.imageMode === true,
      onDelta: value => { if (received(task)) pending.output = value; },
      onEvent: event => {
        if (!received(task)) return;
        streamEvent(task, event, images, sources);
        if (event.name === "message_saved") {
          if (typeof event.data.id === "string") saved.serverMessageId = event.data.id;
          if (typeof event.data.isUpvoted === "boolean") saved.feedback = event.data.isUpvoted ? "up" : "down";
        }
      },
      shouldStop: () => controller.signal.aborted || !received(task),
      fetchChatDetail: async id => {
        const list = await detailMessages(request, id, controller.signal);
        const answer = list && matchingAnswer(list, pending);
        return new Response(JSON.stringify({ chatMessages: answer ? [answer] : [] }), { status: 200 });
      },
      resolveImage,
      save: () => { if (received(task)) repository.commit(); }
    };
    return (host?.readStream ?? processChatStream)(args);
  }

  async function resumeResponse(task: Generation, images: GeneratedImage[], sources: ChatSource[], saved: NativeMessage): Promise<string> {
    const { conversation, pending, controller } = task;
    const signal = controller.signal;
    if (!conversation.chatId) {
      try { conversation.chatId = await recoverChatId(request, conversation, pending, signal); }
      catch { signal.throwIfAborted(); }
      if (!conversation.chatId) throw new Error(INTERRUPTED);
      repository.commit();
    }
    const id = conversation.chatId;
    try {
      const response = await request(resumeStreamPath(id, pending.lastEventId), { accept: "text/event-stream", signal });
      const output = await readStream(task, response, true, images, sources, saved);
      if (output || images.length || saved.serverMessageId) return output;
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      const stream = error as StreamError;
      if (stream?.auth || stream?.fromStream || (stream?.status && ![404, 409, 410, 503, 504].includes(stream.status))) throw error;
    }
    if (!pending.userServerId && !Array.isArray(pending.baselineIds)) throw new Error(INTERRUPTED);
    for (let attempt = 0; attempt < RECOVERY_POLLS; attempt++) {
      let list: Awaited<ReturnType<typeof detailMessages>> | undefined;
      try { list = await detailMessages(request, id, signal); }
      catch { signal.throwIfAborted(); }
      const answer = list && matchingAnswer(list, pending);
      if (answer) {
        const text = messageText(answer);
        const recovered = collectGeneratedImages(answer);
        if (text || recovered.length) {
          saved.serverMessageId = answer.id;
          if (typeof answer.isUpvoted === "boolean") saved.feedback = answer.isUpvoted ? "up" : "down";
          collectSourceUrls(answer, sources, new Set(sources.map(source => source.url)));
          for (const image of recovered) {
            const found = { ...image, messageId: answer.id, chatId: id };
            if (!images.some(item => generatedImageKey(item) === generatedImageKey(found))) images.push(found);
          }
          return text;
        }
      }
      if (attempt + 1 < RECOVERY_POLLS) await waitUntilRetry(2000, signal);
    }
    throw new Error(INTERRUPTED);
  }

  async function startResponse(task: Generation, sent: NativeAttachment[], images: GeneratedImage[], sources: ChatSource[], saved: NativeMessage) {
    const { conversation, pending, controller } = task;
    const signal = controller.signal;
    const preflight = async () => {
      try {
        if (conversation.chatId) {
          const list = await detailMessages(request, conversation.chatId, signal);
          if (list) pending.baselineIds = list.map(item => item.id);
        } else {
          pending.baselineIds = [];
          const recent = await recentChats(request, signal);
          if (recent) pending.recentChatIds = recent.map(row => row.id);
        }
      } catch { signal.throwIfAborted(); }
    };
    const [, source] = await Promise.all([preflight(), previousImageSource(task, sent), syncInstructions(task)]);
    signal.throwIfAborted();
    if (!received(task)) throw new DOMException("Session changée.", "AbortError");
    const fileIds = sent.filter(file => file.remoteKind === "file" && file.remoteId).map(file => file.remoteId as string);
    const imageIds = sent.filter(file => (file.remoteKind === "legacy" || file.remoteKind === "image") && file.remoteId).map(file => file.remoteId as string);
    if (source) fileIds.push(source);
    const imagePrompt = pending.imageMode ?
      "[Génération d’image] Utilise obligatoirement l’outil de génération d’image pour créer l’image demandée.\n\n" : "";
    const sourcePrompt = source ?
      "[Image source] Si la demande est une modification, utilise la dernière image générée jointe et conserve les éléments non concernés.\n\n" : "";
    pending.requestText = imagePrompt + sourcePrompt + pending.text;
    pending.dispatchStarted = true;
    pending.startedAt = Date.now();
    repository.commit();
    const response = await request("/chats/stream", {
      method: "POST", accept: "text/event-stream", signal, body: {
        agentId: conversation.agentId, chatId: conversation.chatId ?? null,
        projectId: conversation.projectId || undefined, enableWebSearch: webSearch && local.read().webSearchMode !== "disabled",
        images: imageIds, files: fileIds.length ? fileIds : undefined, initialContent: pending.requestText
      }
    });
    return readStream(task, response, false, images, sources, saved);
  }

  async function cancelServer(chatId: string): Promise<boolean> {
    const session = lifetime.signal;
    if (session.aborted) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CANCEL_TIMEOUT);
    const close = () => controller.abort();
    session.addEventListener("abort", close, { once: true });
    try {
      const response = await request(chatPath(chatId) + "/stream/cancel", { method: "POST", signal: controller.signal });
      void response.body?.cancel().catch(() => {});
      return response.ok;
    } catch { return false; }
    finally {
      session.removeEventListener("abort", close);
      clearTimeout(timeout);
    }
  }

  function finalise(task: Generation, saved: NativeMessage, images: GeneratedImage[], sources: ChatSource[], output: string) {
    const { conversation, pending } = task;
    conversation.messages = conversation.messages.slice(0, (pending.userIndex as number) + 1);
    saved.content = output || (images.length ? "" : task.stop ? "*Génération arrêtée.*" : "*Réponse vide.*");
    if (images.length) {
      saved.images = storedImages(images);
      transientImages.set(saved, images);
    }
    if (sources.length) saved.sources = sources;
    conversation.messages.push(saved);
    conversation.pendingResponse = undefined;
  }

  async function run(conversation: NativeConversation, pending: NativePending, sent: NativeAttachment[], resume: boolean) {
    const task: Generation = {
      conversation, pending, controller: new AbortController(), stop: false, suspended: false, owner: repository.owner()
    };
    active = task;
    const images = resume ? [...(pending.images ?? [])] : [];
    const sources = resume ? [...(pending.sources ?? [])] : [];
    const saved: NativeMessage = { role: "assistant", content: "" };
    repository.commit();
    changed();
    try {
      const answer = resume ? await resumeResponse(task, images, sources, saved) : await startResponse(task, sent, images, sources, saved);
      if (!received(task)) return;
      if (task.stop || task.suspended) throw task.controller.signal.reason ?? new Error(INTERRUPTED);
      finalise(task, saved, images, sources, answer);
      if (local.read().completionNotifications && document.visibilityState === "hidden") {
        void options.notifyCompletion?.(conversation.title || "Discussion").catch(() => {});
      }
    } catch (error) {
      if (!received(task)) return;
      const stopped = task.stop && await task.cancelResult;
      if (!received(task)) return;
      if (stopped) finalise(task, saved, images, sources, pending.output || "");
      else {
        const failure = error as StreamError;
        const explicit = failure?.auth || failure?.fromStream || Boolean(failure?.status && (!resume || ![404, 409, 410, 503, 504].includes(failure.status)));
        const interrupted = pending.dispatchStarted !== false && (task.stop || task.suspended || !explicit);
        if (interrupted) pending.state = "interrupted";
        else conversation.pendingResponse = undefined;
        conversation.messages = conversation.messages.slice(0, (pending.userIndex as number) + 1);
        if (pending.output) conversation.messages.push({ role: "assistant", content: pending.output });
        if (!task.suspended || task.stop) conversation.messages.push({
          role: "error", content: interrupted ? INTERRUPTED : friendlyError(error, typeof navigator === "undefined" ? undefined : navigator.onLine)
        });
      }
    } finally {
      if (!lifetime.signal.aborted && repository.owner() === task.owner && repository.get(conversation.id) === conversation) {
        conversation.updatedAt = Date.now();
        repository.commit();
      }
      if (active === task) active = null;
      changed();
      if (task.suspended && typeof document !== "undefined" && !document.hidden) queueMicrotask(recoverOnForeground);
    }
  }

  async function resume(id: string) {
    if (active || pendingCancellation || !host) return;
    const conversation = repository.get(id);
    const pending = canUse(conversation) ? recoverablePending(conversation, repository.owner()) : undefined;
    if (!conversation || !pending) throw new Error("Aucune réponse à reprendre.");
    if (pending.dispatchStarted === false) {
      conversation.pendingResponse = undefined;
      conversation.messages = conversation.messages.slice(0, (pending.userIndex as number) + 1);
      conversation.messages.push({ role: "error", content: "L’envoi a été interrompu avant de joindre le serveur. Tu peux réessayer." });
      repository.commit();
      return;
    }
    repository.select(id);
    await run(conversation, pending, [], true);
  }

  async function cancelPending(id: string) {
    if (active || pendingCancellation || !host) return;
    const conversation = repository.get(id);
    const pending = canUse(conversation) ? recoverablePending(conversation, repository.owner()) : undefined;
    if (!conversation || !pending) throw new Error("Aucune réponse à annuler.");
    pendingCancellation = true;
    changed();
    try {
      const owner = repository.owner();
      if (conversation.chatId && pending.dispatchStarted !== false && !await cancelServer(conversation.chatId)) {
        throw new Error("Le serveur n’a pas confirmé l’arrêt de cette réponse.");
      }
      if (lifetime.signal.aborted || owner !== repository.owner()) return;
      conversation.messages = conversation.messages.slice(0, (pending.userIndex as number) + 1);
      if (pending.output) conversation.messages.push({ role: "assistant", content: pending.output });
      conversation.pendingResponse = undefined;
      repository.commit();
    } finally {
      pendingCancellation = false;
      changed();
    }
  }

  function recoverOnForeground() {
    if ((typeof document !== "undefined" && document.hidden) || (typeof navigator !== "undefined" && !navigator.onLine) ||
        active || pendingCancellation || !host) return;
    const conversation = repository.current();
    if (canUse(conversation) && conversation.pendingResponse?.state === "interrupted") {
      void resume(conversation.id).catch(error => toast(error instanceof Error ? error.message : INTERRUPTED, true));
    }
  }

  function visibilityChanged() {
    if (!document.hidden) { recoverOnForeground(); return; }
    const task = active;
    if (!task || task.stop || task.controller.signal.aborted) return;
    // Seule la lecture locale du SSE est interrompue. Le serveur peut continuer à générer.
    if (task.pending.dispatchStarted !== false) {
      task.suspended = true;
      task.pending.state = "interrupted";
      repository.commit();
      task.controller.abort();
    }
  }

  function begin(conversation: NativeConversation, text: string, sent: NativeAttachment[]) {
    const pending: NativePending = {
      text, output: "", lastEventId: "", startedAt: Date.now(), owner: repository.owner(),
      userIndex: conversation.messages.length - 1, dispatchStarted: false, imageMode: imageMode && !isPowerPointPrompt(text)
    };
    conversation.pendingResponse = pending;
    conversation.updatedAt = Date.now();
    void run(conversation, pending, sent, false);
  }

  function openImageSearch(input: string, query: string): boolean {
    if (local.read().webSearchMode !== "open") {
      toast("La recherche Wikimedia Commons nécessite le mode de recherche web Ouvert.", true);
      return false;
    }
    const conversation: NativeConversation = {
      id: crypto.randomUUID(), projectId: repository.projectId(), updatedAt: Date.now(),
      title: ("Images · " + query).slice(0, 100), localImageSearch: true,
      messages: [{ role: "user", content: input }, { role: "assistant", content: "", imageSearch: { query } }]
    };
    try {
      repository.add(conversation);
      repository.select(conversation.id);
      repository.commit();
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Impossible d’ouvrir la recherche d’images.", true);
      return false;
    }
  }

  function send(text: string, skillPrefix?: string): boolean {
    const displayed = text.trim();
    if (!host || active || pendingCancellation || !attachments.ready() || (!displayed && !carried.length && !attachments.snapshot().length)) return false;
    const current = repository.current();
    if ((current && !canUse(current)) || current?.pendingResponse) return false;
    const query = !skillPrefix && !imageMode && !carried.length && !attachments.snapshot().length ? imageSearchQuery(displayed) : null;
    if (query) return openImageSearch(displayed, query);
    const existing = current?.localImageSearch ? undefined : current;
    const agent = pickedAgent();
    if (!agent) {
      toast("Aucun modèle disponible. Réessaie quand le catalogue est chargé.", true);
      return false;
    }
    const conversation = existing ?? {
      id: crypto.randomUUID(), messages: [], projectId: repository.projectId(), updatedAt: Date.now(),
      title: (displayed || carried[0]?.name || attachments.snapshot()[0]?.name || "Discussion").slice(0, 100)
    };
    try {
      if (!existing) repository.add(conversation);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
      return false;
    }
    const before = edit?.id === existing?.id ? edit?.index : undefined;
    const sent = [...carried, ...attachments.take()];
    carried = [];
    edit = undefined;
    repository.select(conversation.id);
    if (before !== undefined) {
      conversation.messages = conversation.messages.slice(0, before);
      conversation.chatId = undefined;
    }
    const changedAgent = conversation.agentId !== undefined && conversation.agentId !== agent.id;
    if (changedAgent) conversation.chatId = undefined;
    const recap = before !== undefined || changedAgent ? contextSummary(conversation.messages) : "";
    conversation.agentId = agent.id;
    conversation.agentName = agent.name;
    conversation.agentProvider = agent.provider;
    const input = fileContents(displayed, sent) || (sent.some(file => file.kind === "image") ? "Décris cette image." : "Analyse ce fichier.");
    const last = conversation.messages[lastUser(conversation.messages)];
    const prompt = chatPrompt(input, { skillPrefix, studyMode, powerpointMode, previousPrompt: last?.prompt });
    // La marque PowerPoint reste la première ligne du prompt de format.
    const prepared = isPowerPointPrompt(prompt) ? prompt + (recap ? "\n\n" + recap : "") : recap + prompt;
    conversation.messages.push({ role: "user", content: displayed, prompt: prepared, attachments: sent.length ? sent : undefined });
    draft = { seq: draft.seq + 1, text: "" };
    begin(conversation, prepared, sent);
    return true;
  }

  function regenerate(index: number) {
    const conversation = repository.current();
    if (!canUse(conversation) || active || pendingCancellation || !host) return;
    if (conversation.pendingResponse) {
      void resume(conversation.id).catch(error => toast(error instanceof Error ? error.message : INTERRUPTED, true));
      return;
    }
    const userIndex = lastUser(conversation.messages, index);
    if (userIndex < 0) return;
    const message = conversation.messages[userIndex];
    const agent = pickedAgent();
    if (!agent) return;
    conversation.messages = conversation.messages.slice(0, userIndex + 1);
    const sent = message.attachments ?? [];
    let prompt = message.prompt || fileContents(message.content, sent);
    if (conversation.agentId !== agent.id) {
      conversation.chatId = undefined;
      conversation.agentId = agent.id;
      conversation.agentName = agent.name;
      conversation.agentProvider = agent.provider;
      const recap = contextSummary(conversation.messages.slice(0, userIndex));
      prompt = isPowerPointPrompt(prompt) ? prompt + "\n\n" + recap : recap + prompt;
    }
    begin(conversation, prompt, sent);
  }

  function editSent(index: number) {
    const conversation = repository.current();
    if (!canUse(conversation) || active || pendingCancellation || conversation.pendingResponse) return;
    const message = conversation.messages[index];
    if (!message || message.role !== "user") return;
    attachments.clear();
    carried = (message.attachments ?? []).map(file => ({ ...file }));
    edit = { id: conversation.id, index };
    draft = { seq: draft.seq + 1, text: message.content };
    changed();
  }

  function editFailed(index: number) {
    const conversation = repository.current();
    if (!canUse(conversation)) return;
    const previous = lastUser(conversation.messages, index);
    if (previous >= 0) editSent(previous);
  }

  function setOption(name: ChatOptionName, value: string | boolean) {
    if (active) return;
    if (name === "webSearch") {
      if (local.read().webSearchMode === "disabled") return;
      webSearch = value === true;
      writePreferences({ webSearch });
    } else if (name === "imageMode") {
      imageMode = value === true;
      if (imageMode) powerpointMode = false;
      writePreferences({ imageMode });
    } else if (name === "powerpointMode") {
      powerpointMode = value === true;
      if (powerpointMode) {
        imageMode = false;
        studyMode = "";
        writePreferences({ imageMode, studyMode });
      }
    } else if (name === "studyMode" && (value === "fiches" || value === "quiz" || value === "cartes" || value === "")) {
      studyMode = value;
      if (value) powerpointMode = false;
      writePreferences({ studyMode });
    } else if (name === "imageModel" && typeof value === "string") {
      try { local.update({ imageModel: value }); }
      catch (error) { toast(error instanceof Error ? error.message : String(error), true); }
    }
    changed();
  }

  function targetMessage(index: number) {
    const conversation = repository.current();
    return canUse(conversation) ? conversation.messages[index] : undefined;
  }

  async function vote(index: number, up: boolean) {
    const conversation = repository.current();
    const message = targetMessage(index);
    if (!conversation || !message || voting.has(message) || message.feedback === (up ? "up" : "down")) return;
    if (!message.serverMessageId) {
      toast("Vote indisponible pour ce message. Recharge la conversation pour le synchroniser.", true);
      return;
    }
    voting.add(message);
    const signal = lifetime.signal;
    try {
      const answer = await api.json<{ isUpvoted: boolean }>("/messages/" + encodeURIComponent(message.serverMessageId), {
        method: "PATCH", body: { isUpvoted: up }, signal
      });
      if (signal.aborted || !conversation.messages.includes(message)) return;
      if (typeof answer?.isUpvoted !== "boolean") throw new Error("Le serveur n’a pas confirmé le vote.");
      message.feedback = answer.isUpvoted ? "up" : "down";
      repository.commit();
    } catch (error) {
      if (!signal.aborted) toast("Vote impossible : " + (error instanceof Error ? error.message : String(error)), true);
    } finally { voting.delete(message); }
  }

  function preview(target: PreviewTarget) {
    const file = target.pending ? attachments.lookup(target.pending) ?? carried.find(item => item.id === target.pending) :
      targetMessage(target.messageIndex ?? -1)?.attachments?.[target.attachmentIndex ?? -1];
    if (!file) return;
    options.openPreview({ name: file.name, load: signal => attachments.load(file, signal ?? lifetime.signal) });
  }

  async function downloadImage(src: string) {
    const signal = lifetime.signal;
    try {
      const blob = src.startsWith("blob:") ?
        await (await fetch(src, { signal })).blob() :
        await files.image({ [src.startsWith("data:") ? "data" : "url"]: src }, signal, IMAGE_BYTES);
      const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1] || "png";
      if (!blob.type.startsWith("image/") || blob.size > IMAGE_BYTES) throw new Error("Image indisponible.");
      await saveBytes("image-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "." + ext, new Uint8Array(await blob.arrayBuffer()));
      toast("Image enregistrée.");
    } catch (error) {
      if (!signal.aborted) toast("Téléchargement impossible : " + (error instanceof Error ? error.message : String(error)), true);
    }
  }

  async function importRun(input: ImportRequest): Promise<ImportOutcome> {
    const agent = models().find(item => item.id === input.agentId && item.model);
    if (!agent?.model) return { ok: false, noModel: true };
    if (!repository.owner()) return { ok: false, noSession: true };
    const signal = lifetime.signal;
    try {
      const data = await api.json<{ chatId?: string; title?: string; source?: string; sourceConversationId?: string; importedMessagesCount?: number }>(
        "/conversation-imports/openai", { method: "POST", body: { link: input.link, model: agent.model }, signal }
      );
      if (signal.aborted) return { ok: false, aborted: true };
      if (typeof data?.chatId !== "string" || !UUID.test(data.chatId)) {
        void repository.sync().catch(() => {});
        return { ok: false, unexpected: true, message: "Réponse inattendue. Vérifie l’historique avant de réessayer." };
      }
      const existing = repository.all().find(row => !row.serverLocked && repository.get(row.id) && row.chatId === data.chatId);
      const conversation = existing ?? {
        id: crypto.randomUUID(), messages: [], chatId: data.chatId, title: data.title?.trim().slice(0, 100) || "Conversation importée",
        agentId: agent.id, agentName: agent.name, agentProvider: agent.provider, updatedAt: Date.now(), needsLoad: true
      };
      conversation.importedFrom = {
        source: data.source || "openai", sourceConversationId: data.sourceConversationId?.toLowerCase() || input.shareId, shareId: input.shareId
      };
      if (!existing) repository.add(conversation);
      repository.commit();
      return { ok: true, id: conversation.id, count: typeof data.importedMessagesCount === "number" && Number.isInteger(data.importedMessagesCount) ? data.importedMessagesCount : null };
    } catch (error) {
      if (signal.aborted) return { ok: false, aborted: true };
      return { ok: false, status: (error as { status?: number } | null)?.status, message: error instanceof Error ? error.message : String(error) };
    }
  }

  function shareTarget(id: string) {
    const row = repository.get(id);
    if (!canUse(row) || !row.chatId) return null;
    const profile = readPreferences().profile;
    const idValue = profile?.id;
    return { chatId: row.chatId, me: { id: typeof idValue === "number" && Number.isInteger(idValue) ? idValue : null, email: typeof profile?.email === "string" ? profile.email : "" } };
  }

  async function shareCall(command: ShareRequest): Promise<ShareResult> {
    if (!repository.owner()) return { ok: false, noSession: true };
    const selected = shareTarget(command.localId);
    if (!selected) return { ok: false, notSynced: true };
    const signal = lifetime.signal;
    try {
      const data = await api.json(chatPath(selected.chatId) + "/shares", {
        method: command.method, body: command.method === "GET" ? undefined : command.body ?? {}, signal
      });
      return signal.aborted ? { ok: false, aborted: true } : { ok: true, data };
    } catch (error) {
      if (signal.aborted) return { ok: false, aborted: true };
      return { ok: false, status: (error as { status?: number } | null)?.status, message: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    attach(value) {
      if (lifetime.signal.aborted) lifetime = new AbortController();
      host = value;
      unsubscribe?.();
      unsubscribe = repository.subscribe(repoChanged);
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibilityChanged);
      if (typeof window !== "undefined") window.addEventListener("online", recoverOnForeground);
      repoChanged();
    },
    detach() {
      host = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibilityChanged);
      if (typeof window !== "undefined") window.removeEventListener("online", recoverOnForeground);
      if (active && active.pending.dispatchStarted !== false) {
        active.pending.state = "interrupted";
        repository.commit();
      }
      lifetime.abort();
      active?.controller.abort();
      active = null;
      attachments.clear();
      carried = [];
      unsubscribe?.();
      unsubscribe = undefined;
      for (const item of urls.values()) void item.then(url => { if (url?.startsWith("blob:")) URL.revokeObjectURL(url); });
      urls.clear();
      previousSourceUploads.clear();
    },
    storeImageSearch(id, index, search) {
      const conversation = repository.get(id);
      if (lifetime.signal.aborted || !canUse(conversation) || !conversation.localImageSearch) return;
      const message = conversation.messages[index];
      if (message?.imageSearch?.query !== search.query) return;
      message.imageSearch = search;
      repository.commit();
    },
    async saveImageResult(id, index, input, action) {
      const conversation = repository.get(id);
      const owner = repository.owner();
      const signal = lifetime.signal;
      const image = normalizeCommonsImage(input);
      if (!owner || !canUse(conversation) || !image || !canSaveCommonsImage(image) ||
          !conversation.messages[index]?.imageSearch?.results?.some(row => row.id === image.id && row.original === image.original)) {
        throw new Error("Cette image ne peut pas être enregistrée.");
      }
      const libraryId = owner + ":commons:" + id + ":" + image.id;
      if (action === "library" && await options.previewStorage.libraryEntry(libraryId, owner)) return;
      signal.throwIfAborted();
      const filename = safeFileName(image.title);
      const blob = await files.image({ url: image.original }, signal, IMAGE_BYTES);
      signal.throwIfAborted();
      if (!/^image\/(jpeg|png|webp|gif)$/i.test(blob.type)) throw new Error("Format d’image indisponible.");
      if (repository.owner() !== owner || repository.get(id) !== conversation) throw new Error("La conversation n’est plus disponible.");
      if (action === "download") {
        await saveBytes(filename, new Uint8Array(await blob.arrayBuffer()));
        return;
      }
      const previewId = await options.previewStorage.remember(new File([blob], filename, { type: blob.type }));
      signal.throwIfAborted();
      if (!previewId) throw new Error("Le stockage de la bibliothèque est indisponible.");
      await options.previewStorage.index([{
        owner, id: libraryId, name: filename, kind: "image", direction: "found",
        created: Date.now(), projectId: conversation.projectId ?? "", conversationId: id, previewId,
        attribution: { url: image.source, artist: image.artist, license: image.license }
      }]);
    },
    state, send, regenerate, setOption, editSent, editFailed, vote, preview, resolveImage, downloadImage, resume, cancelPending,
    busy: () => Boolean(active) || pendingCancellation,
    settingsChanged() {
      if (local.read().webSearchMode === "disabled") { webSearch = false; writePreferences({ webSearch }); }
      changed();
    },
    stop() {
      const task = active;
      if (!task || task.stop) return;
      task.stop = true;
      task.cancelResult = task.pending.dispatchStarted === false ? Promise.resolve(true) :
        task.conversation.chatId ? cancelServer(task.conversation.chatId) : Promise.resolve(false);
      task.controller.abort();
      changed();
    },
    setAgent(id) {
      if (active || !agents().some(agent => agent.id === id && agent.available)) return;
      activeAgent = Number(id);
      writePreferences({ agentId: activeAgent });
      changed();
    },
    addFiles(value) { if (host) attachments.add(value); },
    retryUpload: attachments.retry,
    removeAttachment(id) {
      carried = carried.filter(file => file.id !== id);
      attachments.remove(id);
      changed();
    },
    attachmentPreview: attachments.picture,
    image(messageIndex, imageIndex) {
      const row = targetMessage(messageIndex);
      const image = row ? (transientImages.get(row) ?? row.images)?.[imageIndex] : undefined;
      return image ? resolveImage(image) : Promise.resolve(null);
    },
    lockableConversations: () => [],
    importApi: {
      models: () => ({
        models: models().filter(agent => agent.model).map(agent => ({ id: agent.id, label: agentLabel(agent), model: agent.model as string })),
        currentId: pickedAgent()?.id ?? null
      }),
      findExisting: shareId => {
        const found = repository.all().find(row => !row.serverLocked && repository.get(row.id) &&
          (row.importedFrom?.shareId === shareId || row.importedFrom?.sourceConversationId === shareId));
        return found ? { id: found.id, serverArchived: found.serverArchived === true } : null;
      },
      run: importRun
    },
    sharesApi: { target: shareTarget, call: shareCall }
  };
}
