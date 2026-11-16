import axios from "axios";
import { clearSession } from "./utilities/apiAuth";
import { API_URL, getErrorMessage } from "./utilities/api";
import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from "react-router-dom";
import Contacts from "./pages/Contacts";
import Campaigns from "./pages/Campaigns";
import Login from "./pages/Login";
import Loader from "./component/Loader";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./styling/App.css";
import HeaderBar from "./component/HeaderBar";
import { Send, Users, Megaphone, PanelsTopLeft, ShieldBan, UserRoundMinus } from "lucide-react";
import MailPreview from "./pages/MailPreview";
import BlockList from "./pages/BlockList";
import UnsubscribeList from "./pages/UnsubscribeList";

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [retrySession, setRetrySession] = useState(0);

  // Restore a saved session through the backend before rendering protected screens.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const restore = async () => {
      setCheckingSession(true);
      setSessionError("");
      if (!localStorage.getItem("authToken")) {
        setIsLoggedIn(false);
        setCheckingSession(false);
        return;
      }
      try {
        const { data } = await axios.get(API_URL + "/me", { signal: controller.signal });
        if (!active) return;
        const name =
          [data.user.firstName, data.user.lastName].filter(Boolean).join(" ") || data.user.email;
        localStorage.setItem("workspace", JSON.stringify(data.workspace));
        localStorage.setItem("userProfile", JSON.stringify(data.user));
        localStorage.setItem("loggedInUser", name);
        localStorage.setItem("isLoggedIn", "true");
        setLoggedInUser(name);
        setIsLoggedIn(true);
      } catch (error) {
        if (!active || error.code === "ERR_CANCELED") return;
        if (error.response?.status === 401) {
          clearSession();
          setIsLoggedIn(false);
        } else setSessionError(getErrorMessage(error));
      } finally {
        if (active) setCheckingSession(false);
      }
    };
    restore();
    return () => {
      active = false;
      controller.abort();
    };
  }, [retrySession]);

  // Keep session state synchronized with expiry events and other browser tabs.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    const expired = () => {
      setIsLoggedIn(false);
      setLoggedInUser("");
      setSessionError("");
    };
    // A login or logout in another tab requires this tab to revalidate its session.
    const changed = (event) => {
      if (event.key === "authToken") {
        setIsLoggedIn(false);
        setCheckingSession(true);
        setRetrySession((value) => value + 1);
      }
    };
    window.addEventListener("session-expired", expired);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("storage", changed);
    };
  }, []);

  const handleLogin = (name) => {
    setLoggedInUser(name);
    setIsLoggedIn(true);
    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("loggedInUser", name);
  };

  // Clear local access immediately while requesting server-side token revocation.
  const handleLogout = () => {
    const token = localStorage.getItem("authToken");
    axios
      .post(API_URL + "/logout", {}, { headers: { Authorization: "Bearer " + token } })
      .catch(() => {});
    clearSession();
    setIsLoggedIn(false);
    setLoggedInUser("");
  };

  if (checkingSession) return <Loader />;
  if (sessionError)
    return (
      <div className="login-page">
        <div className="login-box">
          <h2>Unable to restore your session</h2>
          <p role="alert">{sessionError}</p>
          <button onClick={() => setRetrySession((value) => value + 1)}>Retry</button>
          <button
            onClick={() => {
              clearSession();
              setSessionError("");
              setIsLoggedIn(false);
            }}
          >
            Back to login
          </button>
        </div>
      </div>
    );

  if (!isLoggedIn) return <Login onLogin={handleLogin} />;
  return (
    <Router>
      <div className="app-container">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <aside className="sidebar" aria-label="Main navigation">
          <div className="brand"><span className="brand-mark"><Send size={20} strokeWidth={2.2} /></span><span>TrueBlaster<span className="brand-dot">.</span></span></div>
          <nav className="nav-links" aria-label="Workspace">
            <p className="nav-group-label">Marketing</p>
            <NavLink to="/campaigns" className={({ isActive }) => isActive ? "active" : ""}><Megaphone size={19} /><span>Campaigns</span></NavLink>
            <NavLink to="/previews" className={({ isActive }) => isActive ? "active" : ""}><PanelsTopLeft size={19} /><span>Templates</span></NavLink>
            <p className="nav-group-label">Audience</p>
            <NavLink to="/contacts" className={({ isActive }) => isActive ? "active" : ""}><Users size={19} /><span>Contact lists</span></NavLink>
            <NavLink to="/blocklist" className={({ isActive }) => isActive ? "active" : ""}><ShieldBan size={19} /><span>Blocklist</span></NavLink>
            <NavLink to="/unsubscribelist" className={({ isActive }) => isActive ? "active" : ""}><UserRoundMinus size={19} /><span>Unsubscribed</span></NavLink>
          </nav>
        </aside>

        {/* Content Area */}
        <div className="content-area">
          <HeaderBar onLogout={handleLogout} username={loggedInUser} />

          <main className="main-content" id="main-content" tabIndex={-1}>
            <Routes>
              <Route path="/" element={<Navigate to="/campaigns" replace />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/blocklist" element={<BlockList />} />
              <Route path="/unsubscribelist" element={<UnsubscribeList />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route path="/previews" element={<MailPreview />} />
              <Route path="*" element={<Navigate to="/campaigns" replace />} />
            </Routes>
          </main>
        </div>
      </div>

      <ToastContainer
        position="top-right"
        autoClose={4000}
        pauseOnHover
        hideProgressBar={false}
        newestOnTop={false}
        theme="light"
      />
    </Router>
  );
};

export default App;
