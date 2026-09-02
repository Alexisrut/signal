/**
 * Хеш-роутер с поддержкой параметров (`/admin/signal/:id`) и query-строки.
 * Он же владеет жизненным циклом экрана: рендер → mount → cleanup.
 */

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return { path: normalized, query: Object.fromEntries(new URLSearchParams(search)) };
}

function matchRoute(routes, path) {
  const segments = path.split('/').filter(Boolean);

  for (const route of routes) {
    const routeSegments = route.path.split('/').filter(Boolean);
    if (routeSegments.length !== segments.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < routeSegments.length; i += 1) {
      const expected = routeSegments[i];
      if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(segments[i]);
      else if (expected !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

export function createRouter({ root, routes, notFound, onRender }) {
  let current = null;
  let cleanup = null;

  function renderCurrent() {
    if (!current) return;
    const { view, ctx } = current;

    const scrollY = window.scrollY;
    try {
      cleanup?.();
    } catch (error) {
      console.error('[router] ошибка cleanup', error);
    }
    cleanup = null;

    root.innerHTML = view.render(ctx);
    cleanup = view.mount?.(root, ctx) ?? null;
    onRender?.(current);
    window.scrollTo({ top: scrollY });
  }

  function resolve() {
    const { path, query } = parseHash(window.location.hash);
    const found = matchRoute(routes, path) ?? { route: { view: notFound, path }, params: {} };

    const ctx = {
      path,
      query,
      params: found.params,
      refresh: renderCurrent,
      navigate,
    };

    // Guard может увести на другой маршрут (например, неавторизованного — на форму входа).
    const redirect = found.route.guard?.(ctx);
    if (redirect) {
      navigate(redirect, { replace: true });
      return;
    }

    /*
     * Наверх страницу возвращает только переход между разделами. Смена
     * фильтра, раскрытие блока статистики и прочие ссылки, меняющие один
     * query, остаются на месте: человек смотрит туда, где нажал, и утаскивать
     * его в начало списка неоткуда — особенно заметно на телефоне, где до
     * фильтров еще надо долистать.
     */
    const samePath = current?.ctx.path === path;
    const scrollY = window.scrollY;

    current = { view: found.route.view, ctx, route: found.route };

    try {
      cleanup?.();
    } catch (error) {
      console.error('[router] ошибка cleanup', error);
    }
    cleanup = null;

    root.innerHTML = current.view.render(ctx);
    cleanup = current.view.mount?.(root, ctx) ?? null;
    onRender?.(current);

    window.scrollTo({ top: samePath ? scrollY : 0 });
  }

  /** Перерисовать экран, если он помечен как «живой» (реагирующий на данные). */
  function refreshIfLive() {
    if (current?.view.live) renderCurrent();
  }

  function start() {
    window.addEventListener('hashchange', resolve);
    resolve();
  }

  return { start, resolve, renderCurrent, refreshIfLive, get current() { return current; } };
}
