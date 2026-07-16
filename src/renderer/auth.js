import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export function watchAuthState(onChange) {
  onAuthStateChanged(auth, onChange);
}

export async function signUp(email, password) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  // Best-effort: a signup that succeeds but fails to send the verification
  // email shouldn't block the user from using the app.
  sendEmailVerification(result.user).catch(() => {});
  return result;
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export function resendVerificationEmail() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return sendEmailVerification(user);
}

export function isEmailVerified() {
  const user = auth.currentUser;
  // Google accounts are considered pre-verified (Google already verified the email).
  if (!user) return false;
  return user.emailVerified || isGoogleUser();
}

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

// Incremental authorization: re-prompts the signed-in Google user for the extra
// Calendar/Tasks scopes, returning a short-lived Google OAuth access token (not
// a Firebase ID token). Only works for accounts signed in via Google.
export async function connectGoogleIntegrations() {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/calendar.events');
  provider.addScope('https://www.googleapis.com/auth/tasks');
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  return credential.accessToken;
}

export function isGoogleUser() {
  const user = auth.currentUser;
  return !!user && user.providerData.some((p) => p.providerId === 'google.com');
}

export function signOutUser() {
  return signOut(auth);
}

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return user.getIdToken();
}
