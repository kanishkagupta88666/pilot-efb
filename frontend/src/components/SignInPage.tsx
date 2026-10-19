import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { EyeIcon, EyeOffIcon, InfoIcon, LockIcon, LogoMark, PersonIcon } from "./Icons";
import { TopBar } from "./TopBar";

/**
 * PROVISIONAL: sign-in screen only. No authentication endpoint exists yet, so the
 * details are not sent or checked anywhere; signing in simply opens the library.
 * The cockpit photo is chosen by the stylesheet: sunset in light mode, night in dark mode.
 */
export function SignInPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);

  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate("/");
  };

  return (
    <main className="sign-in-page">
      <TopBar title="Sign in" />
      <div className="sign-in-scene">
        <div aria-hidden="true" className="sign-in-photo" />
        <div className="sign-in">
          <p className="sign-in__brand">
            <LogoMark />
            Pilot EFB
          </p>
          <h1>Sign in to Pilot EFB</h1>
          <p className="intro">Use your employee ID and password.</p>
          <form className="sign-in__form" onSubmit={signIn}>
            <label htmlFor="employee-id">Employee ID</label>
            <div className="sign-in__field">
              <PersonIcon />
              <input
                autoCapitalize="characters"
                autoComplete="username"
                autoCorrect="off"
                id="employee-id"
                name="employeeId"
                placeholder="Employee ID"
                required
                spellCheck={false}
              />
            </div>
            <label htmlFor="password">Password</label>
            <div className="sign-in__field">
              <LockIcon />
              <input
                autoComplete="current-password"
                id="password"
                name="password"
                placeholder="Password"
                required
                type={showPassword ? "text" : "password"}
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="sign-in__reveal"
                onClick={() => setShowPassword((shown) => !shown)}
                type="button"
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            <button className="button button--primary" type="submit">Sign in</button>
          </form>
          <div className="sign-in__notice">
            <InfoIcon />
            <p>
              <strong>Sign-in is not connected yet.</strong> In this prototype, any details are
              accepted and the library opens directly.
            </p>
          </div>
          <p className="sign-in__help">Can't sign in? Contact your flight operations administrator.</p>
        </div>
      </div>
    </main>
  );
}
