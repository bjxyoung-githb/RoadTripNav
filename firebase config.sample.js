// TEMPLATE / REFERENCE ONLY — this file is never loaded by the app and is
// not required in your GitHub repo. It exists so future updates to this
// project can ship setup instructions without ever touching your real
// firebase-config.js (the file that actually holds your project's values).
//
// If you ever need to recreate firebase-config.js from scratch, copy this
// file's content into it and fill in your real values below.
//
// Firebase project config for the "Share My Trip" feature (live location,
// photos, videos, and comments shared with family via a passcode).
//
// This feature is entirely OPTIONAL — the rest of the app (routing, GPS,
// weather, POIs, etc.) works fully without ever touching this file.
//
// HOW TO FILL THIS IN: see README.md section "7. Setting up trip sharing
// (optional)" for the full step-by-step. Short version:
//   1. Create a free project at https://console.firebase.google.com
//   2. On the project overview page, click "+ Add app" and choose the
//      </> (Web) icon to register a web app.
//   3. Firebase shows you a config object that looks just like the one
//      below — copy YOUR values into your firebase-config.js file,
//      replacing the placeholders.
//   4. Enable Firestore Database (free "Spark" plan, no billing needed) and
//      Authentication -> Sign-in method -> Anonymous, both in the Firebase
//      console left sidebar. Firebase Storage is NOT used on purpose — it
//      now requires the paid Blaze plan just to turn on, so photos are
//      instead stored as compressed text inside Firestore itself, and
//      videos as a Google Drive link, both of which stay free.
//   5. Apply the Firestore security rules from README.md section 7.
//
// It's safe for this file (and these values) to be public in your GitHub
// repo — a Firebase web config is not a secret; access is controlled by
// the security rules you set up in the Firebase console, not by hiding
// these values.

window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
