// Firebase project config for the "Share My Trip" feature (live location,
// photos/videos, and comments shared with family via a passcode).
//
// This feature is entirely OPTIONAL — the rest of the app (routing, GPS,
// weather, POIs, etc.) works fully without ever touching this file.
//
// HOW TO FILL THIS IN: see README.md section "7. Setting up trip sharing
// (optional)" for the full step-by-step. Short version:
//   1. Create a free project at https://console.firebase.google.com
//   2. Add a "Web app" to it (the </> icon on the project overview page).
//   3. Firebase shows you a config object that looks just like the one
//      below — copy YOUR values in below, replacing the placeholders.
//   4. Enable Firestore Database and Storage (both in free/"Spark" mode)
//      and Authentication -> Sign-in method -> Anonymous, all in the
//      Firebase console left sidebar.
//   5. Apply the security rules from README.md to Firestore and Storage.
//
// It's safe for this file (and these values) to be public in your GitHub
// repo — a Firebase web config is not a secret; access is controlled by
// the security rules you set up in the Firebase console, not by hiding
// these values.
//
// Leave the placeholder values in place (don't delete this file) to keep
// "Share & Trip Log" showing friendly "not set up yet" messages instead of
// errors.

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCT5EYnIgtbKm_9_toXt7qFHebyYzpoqBI",
  authDomain: "roadtripnav-share-my-location.firebaseapp.com",
  projectId: "roadtripnav-share-my-location",
  storageBucket: "roadtripnav-share-my-location.firebasestorage.app",
  messagingSenderId: "1099257402786",
  appId: "1:1099257402786:web:f8f7caf446407440968efb",
};
