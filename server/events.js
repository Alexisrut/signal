/**
 * LIVE-режим: шина событий + SSE-канал.
 *
 * Любая мутация данных публикует событие; сервер рассылает его всем открытым
 * вкладкам через `text/event-stream`, а клиент в ответ перечитывает состояние.
 * Так синхронизация работает не только между вкладками одного браузера,
 * но и между разными пользователями и устройствами.
 */

const clients = new Set();
let revision = 0;

export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`retry: 3000\n\n`);
  res.write(`event: hello\ndata: ${JSON.stringify({ rev: revision })}\n\n`);

  const client = { res };
  clients.add(client);

  // Комментарий-пинг не даёт прокси и браузеру закрыть «молчащее» соединение.
  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      cleanup();
    }
  }, 25_000);

  function cleanup() {
    clearInterval(ping);
    clients.delete(client);
  }

  req.on('close', cleanup);
  req.on('error', cleanup);
}

/**
 * Опубликовать изменение.
 * @param {string} type тип изменения (`signal`, `user`)
 * @param {object} payload полезная нагрузка для отладки и точечных обновлений
 */
export function publish(type, payload = {}) {
  revision += 1;

  /*
   * Наружу уходит только номер ревизии. Полезная нагрузка (идентификаторы
   * сигналов, статусы, категории) остается на сервере: поток общий для всех
   * подключенных, и подрядчик получал бы в нем сводку по чужим сигналам.
   * Клиенту хватает сигнала «что-то изменилось» — дальше он перечитывает
   * /api/state, который отфильтрован под его права.
   */
  void type;
  void payload;
  const message = `event: change\ndata: ${JSON.stringify({ rev: revision })}\n\n`;

  for (const client of [...clients]) {
    try {
      client.res.write(message);
    } catch {
      clients.delete(client);
    }
  }
}

export function currentRevision() {
  return revision;
}

export function connectedClients() {
  return clients.size;
}
