/**
 * Текущий пользователь и операции над учетными записями.
 * Роль и права приходят с сервера — клиент их только отображает.
 */

import * as store from '../data/store.js';
import { api } from '../data/api.js';
import { ROLE, isAdminRole, isStaffRole, normalizeNotify } from '/shared/constants.js';

/** Гость: в системе не представлен, но интерфейсу нужен объект, а не null. */
const GUEST = Object.freeze({ id: '', role: null, displayName: 'Гость', guest: true });

export function currentActor() {
  return store.getState().actor ?? GUEST;
}

export function isAuthenticated(actor = currentActor()) {
  return Boolean(actor.id);
}

export function isContractor(actor = currentActor()) {
  return actor.role === ROLE.CONTRACTOR;
}

/** Любой администратор — и обычный, и главный. */
export function isAdmin(actor = currentActor()) {
  return isAdminRole(actor.role);
}

export function isManager(actor = currentActor()) {
  return actor.role === ROLE.MANAGER;
}

/** Сотрудник платформы: администратор, главный администратор или руководитель. */
export function isStaff(actor = currentActor()) {
  return isStaffRole(actor.role);
}

export function isSuperadmin(actor = currentActor()) {
  return actor.role === ROLE.SUPERADMIN;
}

/** Подтверждение почты необязательное — оно ничего не блокирует. */
export function isEmailVerified(actor = currentActor()) {
  return actor.isEmailVerified === true;
}

/**
 * Показывать ли вкладку «Мои сигналы».
 *
 * До первого своего сигнала вкладки нет — пустой раздел в меню только мешает.
 * После появления она остается навсегда: решенные задачи из личного списка
 * не исчезают, а признак на сервере залипающий, поэтому снятие с задачи
 * вкладку не прячет.
 */
export function hasSignalsTab(actor = currentActor()) {
  if (!isAuthenticated(actor)) return false;
  return actor.hasOwnSignals === true || (store.getState().mySignals ?? []).length > 0;
}

/** Категории, доступные текущему пользователю (у главного администратора — все). */
export function myCategories(actor = currentActor()) {
  return actor.categories ?? [];
}

/** Настройки почтовых уведомлений текущего пользователя. */
export function myNotify(actor = currentActor()) {
  return normalizeNotify(actor.notify);
}

/** Полный список учетных записей — сервер отдает его только главному администратору. */
export function listUsers() {
  return store.getState().users ?? [];
}

/** Кого можно назначить исполнителем: руководители и администраторы. */
export function listAssignables() {
  return store.getState().assignables ?? [];
}

/* --------------------------------- действия ---------------------------------- */

export async function login(userLogin, password) {
  const result = await api.login(userLogin, password);
  await store.refresh();
  return result.user;
}

export async function register(input) {
  const result = await api.register(input);
  await store.refresh();
  return result.user;
}

export async function logout() {
  await api.logout();
  await store.refresh();
}

export async function createAdmin(input) {
  const result = await api.createAdmin(input);
  await store.refresh();
  return result;
}

export async function updateCategories(userId, categories) {
  const result = await api.updateUserCategories(userId, categories);
  await store.refresh();
  return result.user;
}

export async function deleteUser(userId) {
  const result = await api.deleteUser(userId);
  await store.refresh();
  return result.deleted;
}

export async function changePassword(input) {
  await api.changePassword(input);
  await store.refresh();
}

export async function updateNotify(notify) {
  const result = await api.updateNotify(notify);
  await store.refresh();
  return result.notify;
}

export async function resendVerification() {
  return api.resendVerification();
}

export function requestPasswordReset(identifier) {
  return api.forgotPassword(identifier);
}

export function checkResetToken(token) {
  return api.checkResetToken(token);
}

export function resetPassword(input) {
  return api.resetPassword(input);
}
