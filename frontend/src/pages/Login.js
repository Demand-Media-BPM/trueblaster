import { API_URL, getErrorMessage } from "../utilities/api";
import React, { useState } from "react";
import axios from "axios";
import "../styling/Login.css";
import { FaEnvelope, FaLock, FaUser } from "react-icons/fa";


const Login = ({ onLogin }) => {
  const [isSignup, setIsSignup] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      const payload = {
        email: email.trim(),
        password,
        ...(isSignup ? { firstName: firstName.trim(), lastName: lastName.trim() } : {}),
      };
      const { data } = await axios.post(API_URL + (isSignup ? "/signup" : "/login"), payload, {
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      if (!data.success || !data.token) throw new Error("Authentication failed");
      localStorage.setItem("authToken", data.token);
      localStorage.setItem("workspace", JSON.stringify(data.workspace));
      localStorage.setItem("userProfile", JSON.stringify(data.user));
      onLogin(
        [data.user.firstName, data.user.lastName].filter(Boolean).join(" ") || data.user.email
      );
    } catch (err) {
      setError(getErrorMessage(err));
      setIsSubmitting(false);
    }
  };
  const switchMode = () => {
    setIsSignup((value) => !value);
    setError("");
    setPassword("");
  };
  return (
    <div className="login-page">
      <div className="login-layout">
      <aside className="login-story"><div className="login-brand">TrueBlaster.</div><div><h2>Good emails.<br />Better connections.</h2><p>Bring your audience together. Create thoughtful campaigns and see how every message performs.</p></div><div className="login-story-note"><span />Your next campaign starts here.</div></aside>
      <form className="login-box" onSubmit={submit}>
        <h1>{isSignup ? "Let’s get started" : "Welcome back"}</h1>
        <p className="subtitle">{isSignup ? "Create your account" : "Log in to your account"}</p>
        {isSignup && (
          <>
            <div className="input-wrapper">
              <FaUser className="input-icon" />
              <input
                aria-label="First name"
                autoComplete="given-name"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                maxLength={100}
                disabled={isSubmitting}
              />
            </div>
            <div className="input-wrapper">
              <FaUser className="input-icon" />
              <input
                aria-label="Last name"
                autoComplete="family-name"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                maxLength={100}
                disabled={isSubmitting}
              />
            </div>
          </>
        )}
        <div className="input-wrapper">
          <FaEnvelope className="input-icon" />
          <input
            aria-label="Email"
            type="email"
            autoComplete="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
            disabled={isSubmitting}
          />
        </div>
        <div className="input-wrapper">
          <FaLock className="input-icon" />
          <input
            aria-label="Password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={isSignup ? 8 : undefined}
            maxLength={256}
            disabled={isSubmitting}
          />
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="login-btn" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Please wait..." : isSignup ? "Sign up" : "Log in"}
        </button>
        <p>
          {isSignup ? "Already have an account? " : "New to TrueBlaster? "}
          <button
            className="auth-switch"
            type="button"
            onClick={switchMode}
            disabled={isSubmitting}
          >
            {isSignup ? "Log in" : "Sign up"}
          </button>
        </p>
      </form>
      </div>
    </div>
  );
};
export default Login;
