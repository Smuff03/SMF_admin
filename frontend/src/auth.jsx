import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getIdTokenResult, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import { auth, firebaseConfigured } from './firebase.js';
import { Button, EmptyState } from './components/ui.jsx';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const MESSAGES = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes or reset your password.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
};
const authMessage = (e) => MESSAGES[e.code] || 'Could not sign in. Please try again.';

/**
 * status: loading | out | denied (signed in without the admin claim) | admin.
 * This only decides what the UI shows. The real enforcement is in firestore.rules and the Cloud Function.
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: firebaseConfigured ? 'loading' : 'unconfigured', user: null });

  const resolve = useCallback(async (user, force = false) => {
    if (!user) return setState({ status: 'out', user: null });
    try {
      const { claims } = await getIdTokenResult(user, force);
      setState({ status: claims.role === 'admin' ? 'admin' : 'denied', user });
    } catch {
      setState({ status: 'out', user: null });
    }
  }, []);

  useEffect(() => (auth ? onAuthStateChanged(auth, (u) => resolve(u, true)) : undefined), [resolve]);

  const value = {
    ...state,
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    signOut: () => fbSignOut(auth),
    recheck: () => resolve(auth.currentUser, true),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function Shell({ children }) {
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="brand dark"><span className="logo">TM</span><div><b>TMF <span>BizHub</span></b><small>Admin workspace</small></div></div>
        {children}
      </div>
    </div>
  );
}

function Login() {
  const { signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    try { await signIn(email.trim(), password); } catch (err) { setError(authMessage(err)); setBusy(false); }
  };
  const forgot = async () => {
    setError(''); setInfo('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter your email above first, then choose “Forgot password”.');
    try { await resetPassword(email.trim()); } catch { /* same message either way, so account existence is not revealed */ }
    setInfo('If an account exists for that email, a reset link is on its way.');
  };

  return (
    <Shell>
      <h1>Sign in</h1>
      <p className="sub">Use your administrator account to continue.</p>
      <form onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="li-email">Email</label>
          <input id="li-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></div>
        <div className="field"><label htmlFor="li-pass">Password</label>
          <input id="li-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {info && <p className="form-info" role="status">{info}</p>}
        <button className="btn btn-primary auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="link auth-forgot" onClick={forgot}>Forgot password?</button>
      </form>
    </Shell>
  );
}

function Denied() {
  const { user, signOut, recheck } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <h1>No admin access</h1>
      <p className="sub"><b>{user.email}</b> is signed in but does not have the admin role. Ask an owner to grant it, then check again.</p>
      <div className="auth-actions">
        <Button variant="primary" onClick={async () => { setBusy(true); await recheck(); setBusy(false); }}>{busy ? 'Checking…' : 'Check again'}</Button>
        <Button onClick={signOut}>Sign out</Button>
      </div>
    </Shell>
  );
}

export function AuthGate({ children }) {
  const { status } = useAuth();
  if (status === 'unconfigured') {
    return <EmptyState title="Firebase is not configured" text="Copy .env.example to .env, fill in the VITE_FIREBASE_* values from your Firebase project settings, and restart the dev server." />;
  }
  if (status === 'loading') return <div className="loading">Loading…</div>;
  if (status === 'out') return <Login />;
  if (status === 'denied') return <Denied />;
  return children;
}
