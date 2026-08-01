/**
 * Текущий пользователь и операции над учетными записями.
 * Роль и права приходят с сервера — клиент их только отображает.
 */

import * as store from '../data/store.js';
import { api } from '../data/api.js';
import { ROLE } from '/shared/constants.js';

const ANONYMOUS = { id: '', role: ROLE.CONTRACTOR, displayName: 'Подрядчик', anonymous: true };

export function currentActor() {
  return store.getState().actor ?? ANONYMOUS;
}

export function isAdmin(actor = currentActor()) {
  return actor.role === ROLE.ADMIN;
}

/** Полноправный администратор: вошел И подтвердил почту. */
export function isVerifiedAdmin(actor = currentActor()) {
  return isAdmin(actor) && actor.isEmailVerified === true;
}

/** Администратор вошел, но панель заблокирована до подтверждения почты. */
export function isPendingVerification(actor = currentActor()) {
  return isAdmin(actor) && actor.isEmailVerified !== true;
}

export function settings(actor = currentActor()) {
  return actor.settings ?? null;
}

export function tasksEnabled(actor = currentActor()) {
  return isVerifiedAdmin(actor) && actor.settings?.tasksDashboardEnabled === true;
}

export function listAdmins() {
  return store.getState().admins ?? [];
}

/* --------------------------------- действия ---------------------------------- */

export async function login(userLogin, password) {
  const result = await api.login(userLogin, password);
  await store.refresh();
  return result.admin;
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

export async function resendVerification() {
  return api.resendVerification();
}

export async function updateSettings(next) {
  const result = await api.updateSettings(next);
  await store.refresh();
  return result.settings;
}
