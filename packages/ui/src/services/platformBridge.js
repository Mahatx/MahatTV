import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Ponte de Plataforma do MahatTV (Web / Electron Desktop / Capacitor Mobile).
 * Isola APIs específicas de cada ambiente para que a UI seja 100% compartilhada.
 */
function detectPlatform() {
  if (typeof window !== 'undefined') {
    if (window.mahatDesktop || navigator.userAgent.toLowerCase().includes('electron')) {
      return 'electron';
    }
    try {
      if (Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()) {
        return 'capacitor';
      }
    } catch {
      // Ambiente web padrão
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

  isStandaloneMobile() {
    return this.isMobileNative() && !this.getApiBaseUrl();
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
    const clean = String(url || '').trim().replace(/\/+$/, '');
    if (!clean) {
      localStorage.removeItem('mahattv_api_base');
    } else {
      localStorage.setItem('mahattv_api_base', clean);
    }
  },

  async initNativeMobile({ onBackButton } = {}) {
    if (!this.isMobileNative()) return;
    document.body.classList.add('platform-mobile-native');

    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#060913' });
    } catch {
      // StatusBar opcional
    }

    if (typeof onBackButton === 'function') {
      try {
        CapApp.addListener('backButton', ({ canGoBack }) => {
          const handled = onBackButton();
          if (!handled && !canGoBack) {
            CapApp.minimizeApp();
          }
        });
      } catch {
        // Ignorar se plugin indisponível
      }
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
