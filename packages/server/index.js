const { startServer } = require('./app');

if (require.main === module) {
  startServer().catch((err) => {
    if (err && err.code === 'EADDRINUSE') {
      process.exit(1);
    }
    console.error('[Erro fatal ao iniciar MahatTV]:', err);
    process.exit(1);
  });
}

module.exports = { startServer };
