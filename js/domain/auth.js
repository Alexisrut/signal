/**
 * Идентичность и доступы.
 *
 * Подрядчик — анонимный пользователь, привязанный к устройству/браузеру:
 * идентификатор генерируется один раз и живет в localStorage, запись в справочнике
 * пользователей создается лениво, при первом реальном действии (создании сигнала).
 *
 * Администратор — учетная запись с логином и паролем; вход хранится отдельным
 * ключом сессии, общим для всех вкладок этого браузера.
 */

import * as store from '../data/store.js';
import { ROLE, DEFAULT_ADMIN } from '../core/constants.js';
import { uid, randomSalt, hashPassword } from '../core/utils.js';

const DEVICE_KEY = 'sms:device:v1';
const SESSION_KEY = 'sms:session:v1';

const sessionListeners = new Set();

function notifySession() {
  for (const listener of sessionListeners) {
    try {
      listener();
    } catch (error) {
      console.error('[auth] ошибка в подписчике сессии', error);
    }
  }
}

export function subscribeSession(listener) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function initAuthSync() {
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage) return;
    if (event.key !== null && event.key !== SESSION_KEY) return;
    notifySession();
  });
}

/* --------------------------------- устройство -------------------------------- */

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uid('ctr');
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function contractorDisplayName(deviceId) {
  return `Подрядчик ${deviceId.slice(-4).toUpperCase()}`;
}

/** Ленивая регистрация подрядчика — вызывается при первом действии. */
export function ensureContractorRecord(draft, deviceId) {
  if (!draft.users[deviceId]) {
    draft.users[deviceId] = {
      id: deviceId,
      role: ROLE.CONTRACTOR,
      displayName: contractorDisplayName(deviceId),
      createdAt: Date.now(),
    };
  }
  return draft.users[deviceId];
}

/* ---------------------------------- сессия ----------------------------------- */

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(value) {
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
  notifySession();
}

/**
 * Текущий действующий пользователь.
 * Администратор — если есть активная сессия; иначе анонимный подрядчик устройства.
 */
export function currentActor() {
  const session = readSession();
  if (session?.userId) {
    const admin = store.getState().users[session.userId];
    if (admin && admin.role === ROLE.ADMIN) {
      return { id: admin.id, role: ROLE.ADMIN, displayName: admin.displayName, login: admin.login };
    }
    // Учетная запись удалена/не найдена — сессия невалидна.
    writeSession(null);
  }

  const deviceId = getDeviceId();
  const known = store.getState().users[deviceId];
  return {
    id: deviceId,
    role: ROLE.CONTRACTOR,
    displayName: known?.displayName ?? contractorDisplayName(deviceId),
    anonymous: !known,
  };
}

export function isAdmin(actor = currentActor()) {
  return actor.role === ROLE.ADMIN;
}

/* ------------------------------- учетные записи ------------------------------- */

function findAdminByLogin(users, login) {
  const needle = String(login).trim().toLowerCase();
  return Object.values(users).find(
    (user) => user.role === ROLE.ADMIN && user.login?.toLowerCase() === needle,
  );
}

export function listAdmins() {
  return Object.values(store.getState().users)
    .filter((user) => user.role === ROLE.ADMIN)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function loginAdmin(login, password) {
  const admin = findAdminByLogin(store.getState().users, login);
  if (!admin) return { ok: false, error: 'Неверный логин или пароль' };

  const hash = await hashPassword(password, admin.salt);
  if (hash !== admin.passwordHash) return { ok: false, error: 'Неверный логин или пароль' };

  writeSession({ userId: admin.id, at: Date.now() });
  return { ok: true, admin };
}

export function logout() {
  writeSession(null);
}

/**
 * Создание администратора. Доступно только администратору
 * (кроме первичного посева системы — `bypassAcl`).
 */
export async function createAdmin({ login, password, displayName }, actor = currentActor(), bypassAcl = false) {
  if (!bypassAcl && !isAdmin(actor)) {
    return { ok: false, error: 'Недостаточно прав: создавать администраторов может только администратор' };
  }

  const cleanLogin = String(login ?? '').trim();
  const cleanName = String(displayName ?? '').trim();
  if (cleanLogin.length < 3) return { ok: false, error: 'Логин должен содержать минимум 3 символа' };
  if (String(password ?? '').length < 6) return { ok: false, error: 'Пароль должен содержать минимум 6 символов' };
  if (!cleanName) return { ok: false, error: 'Укажите отображаемое имя' };

  if (findAdminByLogin(store.getState().users, cleanLogin)) {
    return { ok: false, error: 'Администратор с таким логином уже существует' };
  }

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  const admin = {
    id: uid('adm'),
    role: ROLE.ADMIN,
    login: cleanLogin,
    displayName: cleanName,
    salt,
    passwordHash,
    createdAt: Date.now(),
    createdBy: bypassAcl ? 'system' : actor.id,
  };

  const conflict = store.mutate((draft, abort) => {
    if (findAdminByLogin(draft.users, cleanLogin)) {
      abort();
      return true;
    }
    draft.users[admin.id] = admin;
    return false;
  });

  if (conflict) return { ok: false, error: 'Администратор с таким логином уже существует' };
  return { ok: true, admin };
}

/** Первичный посев: если в системе нет ни одного администратора — создаем дефолтного. */
export async function seedDefaultAdmin() {
  const hasAdmin = Object.values(store.getState().users).some((user) => user.role === ROLE.ADMIN);
  if (hasAdmin) return;
  await createAdmin(DEFAULT_ADMIN, null, true);
}
