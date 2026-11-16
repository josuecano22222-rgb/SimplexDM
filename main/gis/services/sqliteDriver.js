'use strict';

/**
 * Resilient SQLite driver (`main/gis/services/sqliteDriver.js`).
 *
 * Uses native `better-sqlite3` when compiled for the active Node/Electron ABI,
 * and falls back transparently to Node 22+ / Electron 40 built-in `node:sqlite`
 * (`DatabaseSync`, which includes SQLite R*Tree) with a compatible synchronous API.
 */

const fs = require('fs');

let NativeBetterSqlite = null;
try {
  const Candidate = require('better-sqlite3');
  // Smoke-test the native binding against the active runtime ABI
  const probe = new Candidate(':memory:');
  probe.close();
  NativeBetterSqlite = Candidate;
} catch (_) {
  NativeBetterSqlite = null;
}

let NodeDatabaseSync = null;
if (!NativeBetterSqlite) {
  try {
    ({ DatabaseSync: NodeDatabaseSync } = require('node:sqlite'));
  } catch (_) {
    NodeDatabaseSync = null;
  }
}

function toPlainRow(row) {
  if (!row || typeof row !== 'object') return row;
  return Object.assign({}, row);
}

class NodeSqliteStatementAdapter {
  constructor(stmt) {
    this._stmt = stmt;
  }

  all(...params) {
    const rows = this._stmt.all(...params);
    return Array.isArray(rows) ? rows.map(toPlainRow) : [];
  }

  get(...params) {
    const row = this._stmt.get(...params);
    return row === undefined ? undefined : toPlainRow(row);
  }

  run(...params) {
    return this._stmt.run(...params);
  }
}

class NodeSqliteDatabaseAdapter {
  constructor(filePath, options = {}) {
    if (!NodeDatabaseSync) {
      throw new Error(
        'No working SQLite driver available (better-sqlite3 native module failed to load and node:sqlite is unavailable).'
      );
    }
    const readonly = Boolean(options.readonly);
    const fileMustExist = Boolean(options.fileMustExist);
    if (filePath !== ':memory:' && (readonly || fileMustExist)) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Database file does not exist: ${filePath}`);
      }
      // Validate SQLite magic header on non-empty files
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size < 100) {
        throw new Error('File is not a valid SQLite database');
      }
      const fd = fs.openSync(filePath, 'r');
      try {
        const header = Buffer.alloc(16);
        fs.readSync(fd, header, 0, 16, 0);
        if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
          throw new Error('Invalid SQLite file header');
        }
      } finally {
        fs.closeSync(fd);
      }
    }
    this._db = new NodeDatabaseSync(filePath, { readOnly: readonly });
    this.open = true;
    this.readonly = readonly;
    this.name = filePath;
  }

  prepare(sql) {
    return new NodeSqliteStatementAdapter(this._db.prepare(sql));
  }

  exec(sql) {
    this._db.exec(sql);
    return this;
  }

  transaction(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('Expected a function for database.transaction()');
    }
    const db = this._db;
    return (...args) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch (_) {
          /* ignore rollback failure */
        }
        throw err;
      }
    };
  }

  pragma(expr, options = {}) {
    const sql = `PRAGMA ${expr}`;
    if (expr.includes('=')) {
      this._db.exec(sql);
      return undefined;
    }
    const rows = this._db.prepare(sql).all().map(toPlainRow);
    if (options && options.simple) {
      if (!rows.length) return undefined;
      const firstKey = Object.keys(rows[0])[0];
      return firstKey ? rows[0][firstKey] : undefined;
    }
    return rows;
  }

  close() {
    if (this.open) {
      this._db.close();
      this.open = false;
    }
    return this;
  }
}

const SqliteDatabase = NativeBetterSqlite || NodeSqliteDatabaseAdapter;
SqliteDatabase.driverName = NativeBetterSqlite
  ? 'better-sqlite3'
  : NodeDatabaseSync
    ? 'node:sqlite'
    : 'none';

module.exports = SqliteDatabase;
