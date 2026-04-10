it('node:sqlite works', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/tmp/test-jest-sqlite.db');
  db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, val TEXT)');
  db.prepare('INSERT INTO t (val) VALUES (?)').run('hello');
  const rows = db.prepare('SELECT * FROM t').all();
  db.close();
  require('fs').unlinkSync('/tmp/test-jest-sqlite.db');
  expect(rows.length).toBe(1);
});
