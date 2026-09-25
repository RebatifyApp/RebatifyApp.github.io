/* RebataTrack Beta Firebase configuration.
   Firebase Web API keys are intended to be public; access is enforced by Firebase Authentication and Firestore Security Rules. */
window.REBATIFY_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCtOITprwIUbTH3DI3TXJwDYAUIOIrASf4",
  authDomain: "rebatify-beta.firebaseapp.com",
  projectId: "rebatify-beta",
  storageBucket: "rebatify-beta.firebasestorage.app",
  messagingSenderId: "671521571512",
  appId: "1:671521571512:web:01f79bdb54c524dbc3aa4d"
};

window.REBATIFY_BETA_SETTINGS = {
  adminEmail: "support.rebatifyapp@gmail.com",
  testerPortalUrl: "https://rebatifyapp.github.io/beta-login.html",
  emailWorkerUrl: "https://rebatify-beta-email.support-rebatifyapp.workers.dev",
  // Professional beta email is sent by a Cloudflare Worker while Firebase remains on Spark.
  emailAutomationEnabled: true
};
