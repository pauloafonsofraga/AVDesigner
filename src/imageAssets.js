// Shared by catalogue tooling and portable saves/outputs. Never decode/re-encode
// originals: MIME is determined from the bytes, not a filename or HTTP header.
export function imageMime(bytes) {
  const ascii = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
  if (bytes[0] === 137 && ascii(1, 4) === "PNG" && bytes[4] === 13 && bytes[5] === 10) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, 32))) return "image/avif";
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(ascii(0, Math.min(bytes.length, 65536)))) return "image/svg+xml";
  throw new Error("Unsupported or invalid image bytes");
}

export function imageDataUrl(bytes) {
  const mime = imageMime(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function inlineImage(source, { cache = new Map(), fetchImage = fetch, baseUrl = globalThis.location?.href, assets = {} } = {}) {
  if (!source || /^data:image\//i.test(source)) return source;
  const key = String(source);
  if (!cache.has(key)) {
    const pending = (async () => {
      try {
        const response = await fetchImage(new URL(key, baseUrl).href);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const expected = assets[key];
        if (expected) {
          const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
          if (digest !== expected.sha256) throw new Error("Factory artwork checksum mismatch");
        }
        return imageDataUrl(bytes);
      } catch (error) {
        throw new Error(`Required artwork could not be embedded: ${key.slice(0, 180)} (${error.message}). Retry after restoring the asset or connection.`, { cause: error });
      }
    })();
    cache.set(key, pending);
    pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  }
  return cache.get(key);
}

const imageKeys = new Set(["faceImage", "thumbnailImage", "thumbnail", "image", "previewImage", "originalImage", "logo", "companyLogo", "logoSrc"]);

// Operates on a detached project/library snapshot; keys also cover node artwork,
// cards, rack overrides, image objects and all supported title-block logo forms.
export async function inlineProjectArtwork(data, resolveImage, { stripThumbnails = false } = {}) {
  const jobs = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && child && imageKeys.has(key)) {
        if (stripThumbnails && (key === "thumbnail" || key === "thumbnailImage")) delete value[key];
        else jobs.push(Promise.resolve(resolveImage(child)).then(image => { value[key] = image; }));
      } else if (typeof child === "object") visit(child);
    }
  }
  visit(data);
  await Promise.all(jobs);
  return data;
}
