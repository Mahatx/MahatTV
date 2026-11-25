const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const GITHUB_OWNER = 'Ramys';
const GITHUB_REPO = 'Iptv-Brasil-2026';
const GITHUB_BRANCH = 'master';
const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git`;

function fetchGitHubJson(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com${apiPath}`,
      {
        headers: {
          'User-Agent': 'MahatTV-Glass-Stream-Player',
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 12000
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error('Resposta JSON inválida do GitHub'));
            }
          } else {
            reject(new Error(`GitHub API HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timeout ao consultar GitHub API')));
    req.on('error', reject);
  });
}

function downloadFileFromUrl(fileUrl, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      fileUrl,
      {
        headers: { 'User-Agent': 'MahatTV-Glass-Stream-Player' },
        timeout: 30000
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return downloadFileFromUrl(res.headers.location, destPath, onProgress).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Falha no download HTTP ${res.statusCode}`));
        }

        const outStream = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          if (onProgress) onProgress(chunk.length);
        });
        res.pipe(outStream);

        outStream.on('finish', () => {
          outStream.close(() => resolve());
        });
        outStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Timeout durante download da lista'));
    });
    req.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function createGithubSyncService(paths, playlistService) {
  const localShaCache = new Map();

  const githubSyncState = {
    repoUrl: GITHUB_REPO_URL,
    checking: false,
    updating: false,
    needsUpdate: false,
    outdatedCount: 0,
    totalRemoteFiles: 0,
    lastCheckedAt: null,
    lastCommitDate: null,
    lastCommitMessage: null,
    lastCommitSha: null,
    error: null,
    updateProgress: {
      currentFile: '',
      completedFiles: 0,
      totalFiles: 0,
      bytesDownloaded: 0,
      totalBytes: 0
    },
    files: []
  };

  function computeLocalGitBlobSha(fileName) {
    const fullPath = path.join(paths.playlistsDir, fileName);
    if (!fs.existsSync(fullPath)) return null;

    const stat = fs.statSync(fullPath);
    const cached = localShaCache.get(fileName);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { sha: cached.sha, size: stat.size };
    }

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha1');
      hash.update(`blob ${stat.size}\0`);
      const stream = fs.createReadStream(fullPath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => {
        const sha = hash.digest('hex');
        localShaCache.set(fileName, { mtimeMs: stat.mtimeMs, size: stat.size, sha });
        resolve({ sha, size: stat.size });
      });
      stream.on('error', reject);
    });
  }

  async function checkGitHubUpdates() {
    if (githubSyncState.checking || githubSyncState.updating) {
      return githubSyncState;
    }

    githubSyncState.checking = true;
    githubSyncState.error = null;

    try {
      const [contents, commitInfo] = await Promise.all([
        fetchGitHubJson(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents?ref=${GITHUB_BRANCH}`),
        fetchGitHubJson(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`).catch(() => null)
      ]);

      if (commitInfo && commitInfo.commit) {
        githubSyncState.lastCommitSha = (commitInfo.sha || '').slice(0, 7);
        githubSyncState.lastCommitDate = commitInfo.commit.committer?.date || commitInfo.commit.author?.date || null;
        githubSyncState.lastCommitMessage = commitInfo.commit.message || '';
      }

      const remoteM3u8 = Array.isArray(contents)
        ? contents.filter((item) => item.type === 'file' && item.name.toLowerCase().endsWith('.m3u8'))
        : [];

      const fileStatuses = [];
      let outdatedCount = 0;

      for (const remote of remoteM3u8) {
        const localInfo = await computeLocalGitBlobSha(remote.name);
        let status = 'up_to_date';

        if (!localInfo) {
          status = 'missing_local';
          outdatedCount++;
        } else if (localInfo.sha !== remote.sha) {
          status = 'outdated';
          outdatedCount++;
        }

        fileStatuses.push({
          name: remote.name,
          remoteSize: remote.size,
          remoteSizeMB: (remote.size / (1024 * 1024)).toFixed(2),
          remoteSha: remote.sha,
          localSize: localInfo ? localInfo.size : 0,
          localSha: localInfo ? localInfo.sha : null,
          status,
          downloadUrl:
            remote.download_url ||
            `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${encodeURIComponent(remote.name)}`
        });
      }

      githubSyncState.files = fileStatuses.sort((a, b) => a.remoteSize - b.remoteSize);
      githubSyncState.totalRemoteFiles = fileStatuses.length;
      githubSyncState.outdatedCount = outdatedCount;
      githubSyncState.needsUpdate = outdatedCount > 0;
      githubSyncState.lastCheckedAt = Date.now();

      console.log(
        `[GitHub Sync] Verificação concluída (${GITHUB_REPO_URL}): ` +
          (outdatedCount > 0
            ? `${outdatedCount} lista(s) precisam de atualização!`
            : `Todas as ${fileStatuses.length} listas estão 100% atualizadas.`)
      );
    } catch (err) {
      githubSyncState.error = err.message;
      console.error('[GitHub Sync] Erro ao verificar atualizações:', err.message);
    } finally {
      githubSyncState.checking = false;
    }

    return githubSyncState;
  }

  async function pullGitHubUpdates(options = {}) {
    if (githubSyncState.updating) {
      return githubSyncState;
    }

    const { forceAll = false, targetFile = null } = options;

    if (!githubSyncState.files.length) {
      await checkGitHubUpdates();
    }

    const toDownload = githubSyncState.files.filter((f) => {
      if (targetFile) return f.name === targetFile;
      if (forceAll) return true;
      return f.status === 'outdated' || f.status === 'missing_local';
    });

    if (!toDownload.length) {
      return githubSyncState;
    }

    githubSyncState.updating = true;
    githubSyncState.error = null;
    githubSyncState.updateProgress = {
      currentFile: toDownload[0].name,
      completedFiles: 0,
      totalFiles: toDownload.length,
      bytesDownloaded: 0,
      totalBytes: toDownload.reduce((acc, f) => acc + (f.remoteSize || 0), 0)
    };

    (async () => {
      try {
        for (const fileInfo of toDownload) {
          githubSyncState.updateProgress.currentFile = fileInfo.name;
          const finalPath = path.join(paths.playlistsDir, fileInfo.name);
          const tmpPath = `${finalPath}.downloading.tmp`;

          console.log(`[GitHub Sync] Baixando ${fileInfo.name} (${fileInfo.remoteSizeMB} MB)...`);
          await downloadFileFromUrl(fileInfo.downloadUrl, tmpPath, (chunkBytes) => {
            githubSyncState.updateProgress.bytesDownloaded += chunkBytes;
          });

          fs.renameSync(tmpPath, finalPath);
          playlistService.invalidateCache(fileInfo.name);
          localShaCache.delete(fileInfo.name);
          githubSyncState.updateProgress.completedFiles++;
          console.log(`[GitHub Sync] ${fileInfo.name} atualizado com sucesso!`);
        }
      } catch (err) {
        githubSyncState.error = `Erro ao atualizar listas: ${err.message}`;
        console.error('[GitHub Sync] Erro no download:', err.message);
      } finally {
        githubSyncState.updating = false;
        githubSyncState.updateProgress.currentFile = '';
        await checkGitHubUpdates();
      }
    })();

    return githubSyncState;
  }

  return {
    githubSyncState,
    checkGitHubUpdates,
    pullGitHubUpdates
  };
}

module.exports = {
  createGithubSyncService
};
