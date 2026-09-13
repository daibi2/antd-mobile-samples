const path = require('path');
const { createApp, openDb } = require('./app');

const port = Number(process.env.PORT || 8000);
const dbPath = process.env.LEDGER_DB || path.join(__dirname, '..', 'data', 'ledger.db');
const app = createApp({ db: openDb(dbPath) });

app.listen(port, '0.0.0.0', () => {
  console.log('记账工具: http://localhost:' + port + '/');
  console.log('SQLite: ' + dbPath);
});
