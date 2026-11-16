import React from "react";
import "../styling/Loader.css";

const Loader = () => (
  <div className="bars-overlay" role="status" aria-label="Loading your workspace">
    <div className="bars-loader">
      {[...Array(5)].map((_, i) => (
        <div key={i} className={`bar bar${i + 1}`} />
      ))}
    </div>
  </div>
);

export default Loader;
