// Shared by the classic app shell, hosted login page and publish API.
(() => {
  const STORAGE_KEY = "av-designer:company-logo:v1";
  const MAX_PUBLISHED_LOGO_LENGTH = 1024 * 1024;

  function titleBlockLogo(block) {
    return String(block?.logo || block?.companyLogo || block?.fields?.companyLogo || "").trim();
  }

  function projectCompanyLogo(blocks = []) {
    return blocks.map(titleBlockLogo).find(Boolean) || "";
  }

  function publishedCompanyLogo(value) {
    // Public branding is an inline PNG, never an arbitrary URL or active SVG.
    if (typeof value !== "string" || value.length > MAX_PUBLISHED_LOGO_LENGTH) return "";
    return /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value) ? value : "";
  }

  function readCompanyLogo(storage) {
    try {
      storage ??= globalThis.localStorage;
      const value = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
      if (!/^data:image\/(png|jpeg|bmp|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value?.source || "")) return null;
      return { source: value.source, name: String(value.name || "Company logo") };
    } catch { return null; }
  }

  function rememberCompanyLogo(value, storage) {
    try {
      storage ??= globalThis.localStorage;
      if (value) storage.setItem(STORAGE_KEY, JSON.stringify({ source: value.source, name: value.name }));
      else storage.removeItem(STORAGE_KEY);
      return true;
    } catch { return false; }
  }

  globalThis.AVDesignerCompanyLogo = Object.freeze({ STORAGE_KEY, MAX_PUBLISHED_LOGO_LENGTH,
    titleBlockLogo, projectCompanyLogo, publishedCompanyLogo, readCompanyLogo, rememberCompanyLogo });
})();
