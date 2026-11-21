import { AVATAR_QUALITY, AVATAR_SIZE } from "./account.ts";

// Photo de profil : recadrage au centre en carré, 256 px, JPEG sur fond blanc (même rendu que l'écran historique).
// Dépend du DOM (Image, canvas) : vérifié dans le navigateur par verify-shell-browser.mjs, pas sous Node.

function drawSquare(image: HTMLImageElement): string {
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (!side) throw new Error("Image vide");
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponible");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const left = (image.naturalWidth - side) / 2;
  const top = (image.naturalHeight - side) / 2;
  context.drawImage(image, left, top, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return canvas.toDataURL("image/jpeg", AVATAR_QUALITY);
}

export function readAvatarImage(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        resolve(drawSquare(image));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible"));
    };
    image.src = url;
  });
}
