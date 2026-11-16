"use strict";
// The native save picker grants access only to the destination selected by the user.
saveFile = async function(name, bytes) { return tauriTransport.saveFile(name, bytes); };
async function saveResponse(name, response) { return tauriTransport.saveResponse(name, response); }
