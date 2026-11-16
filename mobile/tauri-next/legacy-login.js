"use strict";
// Keep the existing login flow while Rust enforces the provider allowlist.
nativeHttp = function() {
  return { request: options => tauriTransport.login({
    url: options.url,
    method: options.method || "GET",
    data: typeof options.data === "string" ? options.data : undefined,
    headers: options.headers || {}
  }) };
};
