#!/usr/bin/env node
// Servidor falso da API de envio do WA-AKG, só para a medição de memória (Fase 11b): aceita enviar,
// marcar como lido e presença sem precisar de uma sessão de WhatsApp conectada. Registra quantas mensagens
// "enviou". Uso: node infra/scripts/fake-wa-akg.mjs [porta]  (e BOT aponta WA_AKG_BASE_URL para ele).
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3999);
let sent = 0;
let id = 0;

createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (req.url === '/_stats') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ sent }));
      return;
    }
    if (req.method === 'POST' && /\/send$/.test(req.url ?? '')) sent++;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: true, data: { key: { id: `FAKE${++id}` } } }));
  });
}).listen(port, '0.0.0.0', () => console.log(`fake WA-AKG em :${port}`));
