const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const DEFAULT_PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT_DIR = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ts': 'video/mp2t',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp4': 'video/mp4',
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
}

/**
 * 流媒体 CORS 跨域代理转发器
 * 1. 自动为视频流添加 Access-Control-Allow-Origin: *
 * 2. 自动移除/伪装 Referer 绕过防盗链限制
 * 3. 完整支持 HTTP 206 Partial Content 与 Range 字节分片
 */
function handleProxy(req, res, targetUrl) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid target URL', targetUrl }));
    return;
  }

  const client = parsedUrl.protocol === 'https:' ? https : http;
  const forwardHeaders = {
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': req.headers['accept'] || '*/*',
    'Accept-Encoding': 'identity', // 避免 gzip 影响视频分片
  };

  // 转发 Range 请求头
  if (req.headers['range']) {
    forwardHeaders['Range'] = req.headers['range'];
  }

  // 关键：伪装 Referer 与 Host 为目标域名，穿透 CDN 防盗链
  forwardHeaders['Host'] = parsedUrl.host;
  forwardHeaders['Referer'] = `${parsedUrl.protocol}//${parsedUrl.host}/`;
  forwardHeaders['Origin'] = `${parsedUrl.protocol}//${parsedUrl.host}`;

  const requestOptions = {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: req.method,
    headers: forwardHeaders,
    timeout: 15000,
  };

  const proxyReq = client.request(requestOptions, (upstreamRes) => {
    // 处理重定向 (301, 302, 307, 308)
    if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location) {
      const redirectUrl = new URL(upstreamRes.headers.location, targetUrl).toString();
      handleProxy(req, res, redirectUrl);
      return;
    }

    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    };

    if (upstreamRes.headers['content-type']) {
      responseHeaders['Content-Type'] = upstreamRes.headers['content-type'];
    }
    if (upstreamRes.headers['content-length']) {
      responseHeaders['Content-Length'] = upstreamRes.headers['content-length'];
    }
    if (upstreamRes.headers['content-range']) {
      responseHeaders['Content-Range'] = upstreamRes.headers['content-range'];
    }
    if (upstreamRes.headers['accept-ranges']) {
      responseHeaders['Accept-Ranges'] = upstreamRes.headers['accept-ranges'];
    }

    res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
    upstreamRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy request failed', message: err.message }));
    }
  });

  req.pipe(proxyReq);
}

/**
 * 静态文件托管
 */
function handleStatic(req, res, pathname) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let filePath = path.join(ROOT_DIR, pathname === '/' ? 'index.html' : pathname);
  filePath = path.normalize(filePath);

  // 安全防穿透检查
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${pathname}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache',
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (pathname === '/proxy') {
    const targetUrl = parsed.query.url;
    if (!targetUrl || typeof targetUrl !== 'string') {
      setCorsHeaders(res);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?url= query parameter' }));
      return;
    }
    handleProxy(req, res, targetUrl);
  } else {
    handleStatic(req, res, pathname);
  }
});

function startServer(port) {
  server.listen(port, () => {
    console.log('\n===============================================================');
    console.log('🚀 Smart Buffer Engine 本地测试服务与 CORS 代理已就绪！');
    console.log(`🌐 网页测试控制台:  http://localhost:${port}/`);
    console.log(`🛡️ 跨域流媒体代理:  http://localhost:${port}/proxy?url=<视频URL>`);
    console.log('===============================================================\n');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[SmartBuffer] 端口 ${port} 已被占用，正在尝试 ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[SmartBuffer] 服务启动异常:', err);
    }
  });
}

startServer(DEFAULT_PORT);
