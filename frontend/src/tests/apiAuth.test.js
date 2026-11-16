jest.mock("axios", () => ({
  __esModule: true,
  default: { interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } },
}));
process.env.REACT_APP_API_URL = "http://localhost:5000";
const axios = require("axios").default;
const { clearSession, authFetch } = require("../utilities/apiAuth");
const attach = axios.interceptors.request.use.mock.calls[0][0];
const reject = axios.interceptors.response.use.mock.calls[0][1];
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("authToken", "test-token");
  // Minimal Fetch Headers interface for the browser test environment.
  global.Headers = class {
    constructor(values = {}) {
      this.values = { ...values };
    }
    set(key, value) {
      this.values[key.toLowerCase()] = value;
    }
    get(key) {
      return this.values[key.toLowerCase()];
    }
  };
});
test("management requests receive the token, external requests do not", () => {
  expect(
    attach({ url: "http://localhost:5000/api/contact/lists", headers: {} }).headers.Authorization
  ).toBe("Bearer test-token");
  expect(
    attach({ url: "https://example.com/api/contact/lists", headers: {} }).headers.Authorization
  ).toBeUndefined();
});
test("CSV downloads attach the token without sending it to external origins", async () => {
  global.fetch = jest.fn().mockResolvedValue({ status: 200 });
  await authFetch("http://localhost:5000/api/campaign/campaign-csv?emailId=test");
  expect(global.fetch.mock.calls[0][1].headers.get("authorization")).toBe("Bearer test-token");
  await authFetch("https://example.com/download");
  expect(global.fetch.mock.calls[1][1].headers.get("authorization")).toBeUndefined();
});
test("expired sessions clear login state and notify the app", async () => {
  localStorage.setItem("isLoggedIn", "true");
  const listener = jest.fn();
  window.addEventListener("session-expired", listener);
  const error = {
    response: { status: 401 },
    config: { url: "http://localhost:5000/api/contact/lists" },
  };
  await expect(reject(error)).rejects.toBe(error);
  expect(localStorage.getItem("authToken")).toBeNull();
  expect(localStorage.getItem("isLoggedIn")).toBeNull();
  expect(listener).toHaveBeenCalledTimes(1);
  window.removeEventListener("session-expired", listener);
});
test("a failed login does not invalidate an existing session", async () => {
  const error = { response: { status: 401 }, config: { url: "http://localhost:5000/login" } };
  await expect(reject(error)).rejects.toBe(error);
  expect(localStorage.getItem("authToken")).toBe("test-token");
});
test("logout clears all workspace session state", () => {
  localStorage.setItem("workspace", "old workspace");
  localStorage.setItem("loggedInUser", "owner");
  clearSession();
  expect(localStorage.getItem("workspace")).toBeNull();
  expect(localStorage.getItem("loggedInUser")).toBeNull();
  expect(localStorage.getItem("authToken")).toBeNull();
});

test("a late unauthorized response cannot clear a newer login", async () => {
  localStorage.setItem("authToken", "newer-token");
  const error = {
    response: { status: 401 },
    config: { url: "http://localhost:5000/api/contact/lists", sessionToken: "older-token" },
  };
  await expect(reject(error)).rejects.toBe(error);
  expect(localStorage.getItem("authToken")).toBe("newer-token");
});

test("a delayed logout retains its original explicit session token", () => {
  localStorage.setItem("authToken", "newer-token");
  const config = attach({
    url: "http://localhost:5000/logout",
    headers: { Authorization: "Bearer original-token" },
  });
  expect(config.headers.Authorization).toBe("Bearer original-token");
  expect(config.sessionToken).toBe("original-token");
});
