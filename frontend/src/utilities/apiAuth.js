import { API_URL } from "./api";
import axios from "axios";

const apiRoot = API_URL;

// Attach credentials only to this backend, never to unrelated request URLs.
function targetsBackend(url, baseURL) {
  if (!apiRoot) return false;
  try {
    const root = new URL(apiRoot, window.location.origin);
    const target = new URL(url, baseURL || window.location.origin);
    return (
      target.origin === root.origin &&
      target.pathname.startsWith(root.pathname.replace(/\/$/, "") + "/")
    );
  } catch {
    return false;
  }
}

export function clearSession() {
  for (const key of [
    "authToken",
    "workspace",
    "isLoggedIn",
    "loggedInUser",
    "userPerms",
    "userProfile",
  ])
    localStorage.removeItem(key);
}

// Ignore late failures from an older session after a newer login has replaced it.
function expired(expectedToken) {
  if (expectedToken !== undefined && localStorage.getItem("authToken") !== expectedToken) return;
  if (localStorage.getItem("authToken")) {
    clearSession();
    window.dispatchEvent(new Event("session-expired"));
  }
}
axios.interceptors.request.use((config) => {
  if (targetsBackend(config.url, config.baseURL)) {
    const explicit = config.headers?.Authorization || config.headers?.get?.("Authorization");
    const token = explicit?.startsWith("Bearer ")
      ? explicit.slice(7)
      : localStorage.getItem("authToken");
    config.sessionToken = token;
    if (!explicit && token) config.headers.Authorization = `Bearer ${token}`;
    config.headers["ngrok-skip-browser-warning"] = "true";
  }
  return config;
});
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      targetsBackend(error.config?.url, error.config?.baseURL) &&
      !["/login", "/signup", "/logout"].some((path) =>
        (error.config?.url || "").split("?")[0].endsWith(path)
      )
    )
      expired(error.config?.sessionToken);
    return Promise.reject(error);
  }
);

export async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  const token = localStorage.getItem("authToken");
  if (token && targetsBackend(url)) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && targetsBackend(url)) expired(token);
  return response;
}
