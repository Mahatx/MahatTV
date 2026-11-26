export const state = {
  playlists: [],
  currentPlaylist: '__LIVE_BR__',
  categories: [],
  currentCategory: 'ALL',
  searchQuery: '',
  typeFilter: 'ALL',
  page: 1,
  limit: typeof window !== 'undefined' && window.innerWidth <= 960 ? 30 : 60,
  totalPages: 1,
  totalItems: 0,
  items: [],
  currentStream: null,
  favorites: JSON.parse(localStorage.getItem('iptv_favorites_v1') || '[]'),
  scannerPollTimer: null,
  githubPollTimer: null,
  viewMode: 'grid', // 'grid' | 'epg'
  uiMode: localStorage.getItem('mahattv_ui_mode') || 'simple', // 'simple' | 'complete'
  sortBy: localStorage.getItem('mahattv_sort_by') || 'default',
  categorySort: localStorage.getItem('mahattv_cat_sort') || 'count', // 'count' | 'az'
  epgOffsetMinutes: -30,
  epgHours: 6,
  epgDedupe: true,
  epgOnlyWithGuide: false,
  epgData: null,
  epgSelectedProgram: null
};
