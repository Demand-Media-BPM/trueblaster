import React from "react";
import { useLocation } from "react-router-dom";
import { ChevronRight, LogOut } from "lucide-react";
import "../styling/HeaderBar.css";

const pageTitles = { "/campaigns": "Campaigns", "/contacts": "Contact lists", "/blocklist": "Blocklist", "/unsubscribelist": "Unsubscribed contacts", "/previews": "Email templates" };

export default function HeaderBar({ onLogout, username }) {
  const { pathname } = useLocation();
  const initials = (username || "User").split(/\s+/).slice(0, 2).map(name => name[0]).join("").toUpperCase();
  return (
    <header className="header-bar">
      <div className="header-breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{pageTitles[pathname] || "Campaigns"}</strong></div>
      <div className="header-right"><span className="account-avatar" aria-hidden="true">{initials}</span><span className="account-name">{username}<small>Your account</small></span><button className="logout-btn" aria-label="Log out" onClick={onLogout}><LogOut size={16} /><span>Log out</span></button></div>
    </header>
  );
}
