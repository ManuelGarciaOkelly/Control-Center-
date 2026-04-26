import { promises as fs, createReadStream } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// PUBLIC_DIR will be packages/dashboard/src/public
const PUBLIC_DIR = resolve(__dirname, 'public');

function getContentType(ext) {
  switch (ext) {
    case '.html': return 'text/html';
    case '.css': return 'text/css';
    case '.js': return 'application/javascript';
    case '.json': return 'application/json';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

export function mountDashboard(app) {
  // Assuming 'app' has a .use() method to register middleware-like functions
  app.use(async (req, res, next) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let filePath = url.pathname;

    // Do not serve /api or /events
    if (filePath.startsWith('/api') || filePath.startsWith('/events')) {
      return next(); // Pass control to the next handler
    }

    if (filePath === '/') {
      filePath = '/index.html';
    }

    const absFilePath = join(PUBLIC_DIR, filePath);

    try {
      const stat = await fs.stat(absFilePath);
      if (stat.isFile()) {
        const contentType = getContentType(extname(absFilePath));
        res.writeHead(200, { 'Content-Type': contentType });
        createReadStream(absFilePath).pipe(res);
      } else {
        next(); // Not a file or a directory, pass to next handler (e.g., 404)
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        next(); // File not found, pass to next handler (e.g., 404)
      } else {
        console.error('Error serving static file:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  });
}
