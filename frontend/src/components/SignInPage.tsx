import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "./TopBar";

/**
 * PROVISIONAL: sign-in screen only. No authentication endpoint exists yet, so the
 * details are not sent or checked anywhere; signing in simply opens the library.
 */
export function SignInPage() {
  const navigate = useNavigate();

  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate("/");
  };

  return (
    <main className="sign-in-page">
      <TopBar title="Sign in" />
      <div className="sign-in">
        <h1>Sign in to Pilot EFB</h1>
        <p className="intro">Use your employee ID and password.</p>
        <form className="sign-in__form" onSubmit={signIn}>
          <label htmlFor="employee-id">Employee ID</label>
          <input
            autoCapitalize="characters"
            autoComplete="username"
            autoCorrect="off"
            id="employee-id"
            name="employeeId"
            required
            spellCheck={false}
          />
          <label htmlFor="password">Password</label>
          <input
            autoComplete="current-password"
            id="password"
            name="password"
            required
            type="password"
          />
          <button className="button button--primary" type="submit">Sign in</button>
        </form>
        <p className="sign-in__notice">
          Sign-in is not connected yet. In this prototype, your details are not checked and
          the library opens directly.
        </p>
        <p className="prototype-note">
          Can't sign in? Contact your flight operations administrator.
        </p>
      </div>
    </main>
  );
}
