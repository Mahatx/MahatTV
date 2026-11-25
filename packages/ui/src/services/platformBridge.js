/**
 * Ponte de Plataforma do MahatTV (Web / Electron Desktop / Capacitor Mobile).
 * Isola APIs específicas de cada ambiente para que a UI seja 100% compartilhada.
 */
function detectPlatform() {
  if (typeof window !== 'undefined') {
    if (window.mahatDesktop || navigator.userAgent.toLowerCase().includes('electron')) {
      return 'electron';
    }
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
      return 'capacitor';
    }
  }
  return 'web';
}

export const platformBridge = {
  platform: detectPlatform(),

  isDesktop() {
    return this.platform === 'electron';
  },

  isMobileNative() {
    return this.platform === 'capacitor';
  },

  getApiBaseUrl() {
    if (typeof window === 'undefined') return '';
    if (window.mahatDesktop && window.mahatDesktop.apiBaseUrl) {
      return window.mahatDesktop.apiBaseUrl.replace(/\/+$/, '');
    }
    if (window.__MAHATTV_API_BASE__) {
      return String(window.__MAHATTV_API_BASE__).replace(/\/+$/, '');
    }
    const stored = localStorage.getItem('mahattv_api_base');
    if (stored) {
      return stored.replace(/\/+$/, '');
    }
    return '';
  },

  setCustomApiBaseUrl(url) {
    if (!url) {
      localStorage.removeItem('mahattv_api_base');
    } else {
      localStorage.setItem('mahattv_api_base', url.replace(/\/+$/, ''));
    }
  },

  async copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  }
};
