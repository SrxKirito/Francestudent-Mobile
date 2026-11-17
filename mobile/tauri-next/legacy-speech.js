"use strict";
// Le parent ne fournit ce pont que sur une plateforme mobile compatible.
nativeSpeechPlugin = function() { return window.parent.__franceStudentSpeech || null; };
