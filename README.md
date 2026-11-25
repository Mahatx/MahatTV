<p align="center">
  <img src="./packages/ui/public/logo.png" alt="MahatTV Logo" width="180" />
</p>

# 📺 MahatTV • Glass Stream Player

Aplicação moderna de IPTV com design **Liquid Glass (Glassmorphism)**, **Modo TV Imersivo**, **Guia de Programação (EPG)** e arquitetura modular preparada para evoluir para **Aplicativo Desktop (Electron)** e **Aplicativo Mobile (Capacitor)**.

---

## ✨ Funcionalidades Principais

- **📺 Modo Simples (Estilo Smart TV) & Modo Completo**:
  - No **Modo Simples**, abrir um canal coloca o vídeo em **tela cheia imersiva** com HUD auto-ocultável, zapping (`↑`/`↓`) e **sobreposição unificada em vidro** para canais, busca, categorias e guia de programação.
  - No **Modo Completo** (alternável em **⚙️ Configurações**), todos os controles técnicos (Anti-Travamento, Proxy, Modo TS, URL do stream, Scanner e GitHub Sync) ficam expostos diretamente na tela.
- **📅 Guia de Programação (EPG Brasileiro)**:
  - Timeline horizontal interativa sincronizada com a **categoria e ordenação selecionadas**, com sinopse, capa, linha `AGORA`, barra de progresso e mini-guia integrado no player e no HUD da TV.
- **🔤 Organização Unificada (Grade + Guia + Categorias)**:
  - Ordenação por lista, A→Z, Z→A, Online Primeiro, Favoritos Primeiro, Com Guia EPG Primeiro, Maior Qualidade (`4K/FHD/HD`) e Categoria A→Z.
- **🎬 Player Anti-Travamento**:
  - Conversão inteligente de streams `.ts` (Xtream/XUI) para **HLS (`.m3u8`)** + **Proxy de Reconexão Contínua** no backend e controles customizados com indicador **`● AO VIVO`**.
- **⚡ Verificador de Canais Ao Vivo (Scanner) & 🔄 GitHub Sync**:
  - Testa canais ao vivo em lote (ignorando VOD `.mp4`) e sincroniza automaticamente as listas `.m3u8` em `storage/playlists/` via comparação de hash Git (`SHA-1`).

---

## 🚀 Como Executar o Projeto

### Pré-requisitos
- **Node.js** (v18 ou superior)

### Instalar dependências (Vite, `hls.js`, `mpegts.js` e fonte local)
```powershell
npm install
```

### Modo Desenvolvimento (auto-reload do Vite + Servidor Node)
```powershell
npm run dev
```

### Build de Produção + Iniciar
```powershell
npm run build
npm start
```

Após iniciar, acesse: 👉 **http://localhost:3000**

> Na primeira execução em um clone limpo, o **GitHub Sync** detecta automaticamente que `storage/playlists/` está vazia e permite baixar todas as listas `.m3u8` em 1 clique (ou automaticamente se o Auto-Update estiver ativado).

---

## 📂 Arquitetura Modular

```text
MahatTV/
├── package.json                       # Ponto de entrada único (npm start / npm run dev)
├── packages/
│   ├── core/                          # Lógica pura reutilizável (Web, Desktop e Mobile)
│   │   ├── m3u8/                      # Parser #EXTINF e filtro de canais ao vivo
│   │   ├── epg/                       # Parser XMLTV, matching BR e construtor de guia
│   │   ├── channels/                  # Ordenação unificada de canais
│   │   └── streams/                   # Conversão inteligente Xtream -> HLS
│   ├── server/                        # Engine Node.js embarcável (Web + futuro Electron)
│   │   ├── index.js / app.js          # Bootstrap configurável (port, playlistsDir, dataDir)
│   │   ├── config/paths.js            # Resolução de caminhos (dev local ou userData)
│   │   ├── services/                  # Playlists, Scanner, EPG, GitHub Sync, Proxy, Storage
│   │   └── routes/apiRouter.js        # Rotas REST /api/*
│   └── ui/                            # Interface Liquid Glass (ES Modules + CSS modular)
│       ├── index.html
│       ├── public/logo.png
│       └── src/
│           ├── main.js                # Orquestração dos módulos
│           ├── state/                 # store.js e dom.js
│           ├── services/apiClient.js  # Camada de abstração de API (pronta para Desktop/Mobile)
│           ├── features/              # catalog, player, epg, tvMode, settings, scanner, githubSync
│           └── styles/                # tokens, layout, panels, player, epg, settings, tv-mode, responsive
└── storage/                           # Dados locais em runtime (ignorado no Git)
    ├── playlists/                     # Listas .m3u8 e Canais-Online.m3u8
    └── data/                          # verified-streams.json, epg-cache.json, favorites.json
```
