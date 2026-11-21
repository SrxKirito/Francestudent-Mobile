// Feuilles de style historiques, dans l'ordre exact de mobile/www/index.html (test-svelte-styles.mjs le vérifie).
// Ce module n'est chargé que par la nouvelle interface (import dynamique) : le chemin iframe reste inchangé.
// Exclus volontairement : ide-link.css (France IDE retiré de la préversion Tauri, comme dans prepare-legacy.cjs)
// et katex/katex.min.css (chargé à la demande avec KaTeX).
import "../../../www/style.css";
import "../../../www/modern.css";
import "../../../www/image-gen.css";
import "../../../www/quiz.css";
import "../../../www/media.css";
import "../../../www/settings.css";
import "../../../www/design.css";
import "../../../www/design-layout.css";
import "../../../www/design-components.css";
import "../../../www/design-clean.css";
import "../../../www/design-align.css";
import "../../../www/motion.css";
import "../../../www/projects-activity.css";
import "../../../www/settings-align.css";
import "../../../www/composer-layout.css";
import "../../../www/ios-compat.css";
