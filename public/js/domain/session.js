/**
 * Текущий пользователь и операции над учетными записями.
 * Роль и права приходят с сервера — клиент их только отображает.
 */

import * as store from '../data/store.js';
import { api } from '../data/api.js';
import { ROLE, isAdminRole } from '/shared/constants.js';

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

export function isSuperadmin(actor = currentActor()) {
  return actor.role === ROLE.SUPERADMIN;
}

/** Полноправный администратор: вошел И подтвердил почту. */
export function isVerifiedAdmin(actor = currentActor()) {
  return isAdmin(actor) && actor.isEmailVerified === true;
}

/** Администратор вошел, но панель заблокирована до подтверждения почты. */
export function isPendingVerification(actor = currentActor()) {
  return isAdmin(actor) && actor.isEmailVerified !== true;
}

/** Категории, доступные текущему пользователю (у главного администратора — все). */
export function myCategories(actor = currentActor()) {
  return actor.categories ?? [];
}

/** Полный список учетных записей — сервер отдает его только главному администратору. */
export function listUsers() {
  return store.getState().users ?? [];
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

export async function resendVerification() {
  return api.resendVerification();
}
