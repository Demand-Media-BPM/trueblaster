import React from "react";

export default function PageHeader({ title, description, section = "Your workspace", actions }) {
  return (
    <header className="page-heading">
      <div><p className="eyebrow">{section}</p><h1>{title}</h1><p className="page-description">{description}</p></div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
