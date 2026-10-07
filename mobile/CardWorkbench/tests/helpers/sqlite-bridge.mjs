import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

// CI uses Node 20, so exercise production SQL through Python's standard-library
// SQLite rather than adding a native Node dependency to the app.
const pythonCandidates = process.env.PYTHON ? [process.env.PYTHON]
  : process.platform === 'win32' ? ['python'] : ['python3', 'python'];
const python = pythonCandidates.find((command) =>
  spawnSync(command, ['-c', 'import sqlite3'], { stdio: 'ignore' }).status === 0);
if (!python) throw new Error('Database tests require Python 3 with its standard sqlite3 module.');

const pythonBridge = `
import json, sqlite3, sys
connection = sqlite3.connect(':memory:', isolation_level=None)
connection.row_factory = sqlite3.Row
for line in sys.stdin:
    request = json.loads(line)
    try:
        method = request['method']
        if method == 'exec':
            pending = ''
            for character in request['sql']:
                pending += character
                if character == ';' and sqlite3.complete_statement(pending):
                    connection.execute(pending)
                    pending = ''
            if pending.strip():
                connection.execute(pending)
            result = None
        else:
            cursor = connection.execute(request['sql'], request.get('params', []))
            if method == 'run':
                result = {'changes': max(cursor.rowcount, 0), 'lastInsertRowId': cursor.lastrowid}
            elif method == 'first':
                row = cursor.fetchone()
                result = dict(row) if row else None
            else:
                result = [dict(row) for row in cursor.fetchall()]
        print(json.dumps({'id': request['id'], 'result': result}), flush=True)
    except Exception as error:
        print(json.dumps({'id': request['id'], 'error': str(error)}), flush=True)
connection.close()
`;

export function createDatabase(t) {
  const child = spawn(python, ['-u', '-c', pythonBridge], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  const pending = new Map();
  let sequence = 0;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const response = JSON.parse(line);
    const waiter = pending.get(response.id);
    pending.delete(response.id);
    if (response.error) waiter.reject(new Error(response.error));
    else waiter.resolve(response.result);
  });
  const rejectPending = (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  child.on('error', rejectPending);
  child.on('exit', () => rejectPending(new Error(stderr || 'SQLite bridge closed')));
  t.after(() => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.on('close', resolve);
    child.stdin.end();
  }));
  const request = (method, sql, params = []) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, sql, params })}\n`);
  });
  const db = {
    execAsync: (sql) => request('exec', sql),
    runAsync: (sql, ...params) => request('run', sql, params),
    getFirstAsync: (sql, ...params) => request('first', sql, params),
    getAllAsync: (sql, ...params) => request('all', sql, params),
    async withExclusiveTransactionAsync(task) {
      await db.execAsync('BEGIN;');
      try {
        await task(db);
        await db.execAsync('COMMIT;');
      } catch (error) {
        await db.execAsync('ROLLBACK;');
        throw error;
      }
    },
  };
  return db;
}
