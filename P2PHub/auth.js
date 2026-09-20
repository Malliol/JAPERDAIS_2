const SESSION_KEY = "osgovorim-session";

export function getCurrentUser() {
  return sessionStorage.getItem(SESSION_KEY) || null;
}

export function setCurrentUser(username) {
  sessionStorage.setItem(SESSION_KEY, username);
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}
