// ═══════════════════════════════════════════════════════
//  GLITZ OF HORIZON — FIREBASE CONFIG
//  js/firebase.config.js
//  Import file ini di semua HTML yang butuh Firebase
//  Gunakan: <script type="module" src="js/firebase.config.js">
// ═══════════════════════════════════════════════════════

import { initializeApp }          from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
                                   from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc,
         addDoc, collection, query, orderBy,
         onSnapshot, serverTimestamp, increment }
                                   from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// ─────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAp9xtIX74D6Heihn6O-7muB0a6mbQno7Y",
  authDomain:        "glittz-of-horizon.firebaseapp.com",
  projectId:         "glittz-of-horizon",
  storageBucket:     "glittz-of-horizon.firebasestorage.app",
  messagingSenderId: "862322605914",
  appId:             "1:862322605914:web:6f2c26e083dee7857d3d63"
};

// ─────────────────────────────────────────────────────
//  INIT — hanya sekali, semua file pakai ini
// ─────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─────────────────────────────────────────────────────
//  USER DEFAULT SCHEMA
//  Field lengkap saat pertama kali user dibuat
//  Tambah field baru di sini — otomatis tersync
// ─────────────────────────────────────────────────────
const DEFAULT_USER = {
  username:           "Commander",
  avatarId:           "male_infantry",
  wins:               0,
  losses:             0,
  totalDamageDealt:   0,
  totalTurnsTaken:    0,
  avgTurnToWin:       0,
  maxDamagePerTurn:   0,
  infantryUsage:      0,
  archerUsage:        0,
  horsemanUsage:      0,
  spearUsage:         0,
  battlesPlayedToday: 0,
  lastPlayedDate:     "",
  loginStreak:        0,
  lastLoginDate:      "",
  isSpecialUser:      false,
};

// ─────────────────────────────────────────────────────
//  AUTH GUARD
//  Panggil di setiap halaman yang butuh login
//
//  Cara pakai:
//    requireAuth((user, userData) => {
//      // user      = Firebase Auth user object
//      // userData  = Firestore dokumen data
//      // lakukan render / logic di sini
//    });
//
//  Kalau tidak login → otomatis redirect ke login
// ─────────────────────────────────────────────────────
async function requireAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login-signup.html";
      return;
    }

    const userRef = doc(db, "users", user.uid);
    const snap    = await getDoc(userRef);

    let userData;
    if (snap.exists()) {
      // Merge dengan DEFAULT_USER agar field baru tidak hilang
      userData = { ...DEFAULT_USER, ...snap.data() };
    } else {
      userData = {
        ...DEFAULT_USER,
        username: user.displayName || "Commander",
      };
      await setDoc(userRef, userData);
    }

    // Login streak update
    const today     = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (userData.lastLoginDate !== today) {
      const streak = userData.lastLoginDate === yesterday
        ? (userData.loginStreak || 0) + 1
        : 1;
      await updateDoc(userRef, {
        lastLoginDate: today,
        loginStreak:   streak,
      });
      userData.lastLoginDate = today;
      userData.loginStreak   = streak;
    }

    callback(user, userData, userRef);
  });
}

// ─────────────────────────────────────────────────────
//  SAVE BATTLE RESULT
//  Dipanggil dari battle.html setelah match selesai
// ─────────────────────────────────────────────────────
async function saveBattleResult(userRef, userData, battleData) {
  const {
    isVictory, turns, pDmg, eDmg,
    kills, survived, lost, typeCount
  } = battleData;

  const today    = new Date().toDateString();
  const lastDate = userData.lastPlayedDate || "";
  const resetToday = lastDate !== today;

  // Avg turns to win — running average
  const prevWins   = userData.wins || 0;
  let newAvgTurn   = userData.avgTurnToWin || 0;
  if (isVictory && prevWins >= 0) {
    const wins   = prevWins + 1;
    newAvgTurn   = Math.round(((userData.avgTurnToWin || 0) * prevWins + turns) / wins);
  }

  const newMaxDmg = Math.max(userData.maxDamagePerTurn || 0, pDmg);

  await updateDoc(userRef, {
    wins:               isVictory ? increment(1) : increment(0),
    losses:             isVictory ? increment(0) : increment(1),
    totalDamageDealt:   increment(pDmg),
    totalTurnsTaken:    increment(turns),
    avgTurnToWin:       newAvgTurn,
    maxDamagePerTurn:   newMaxDmg,
    infantryUsage:      increment(typeCount.sword  || 0),
    archerUsage:        increment(typeCount.archer || 0),
    horsemanUsage:      increment(typeCount.horse  || 0),
    spearUsage:         increment(typeCount.spear  || 0),
    battlesPlayedToday: resetToday ? 1 : increment(1),
    lastPlayedDate:     today,
  });

  // Simpan ke match history subcollection
  const uid = userRef.id;
  await addDoc(collection(db, "users", uid, "matchHistory"), {
    result:    isVictory ? "win" : "loss",
    turns,
    pDmg,
    eDmg,
    kills,
    survived,
    lost,
    unitTypes: typeCount,
    mode:      "bandit",
    timestamp: serverTimestamp(),
  });
}

// ─────────────────────────────────────────────────────
//  PRESENCE — update "online" status
// ─────────────────────────────────────────────────────
async function initPresence(user, userData) {
  const presenceRef = doc(db, "presence", user.uid);
  const title = getCombatTitle(
    userData.infantryUsage  || 0,
    userData.archerUsage    || 0,
    userData.horsemanUsage  || 0,
    userData.spearUsage     || 0
  );

  await setDoc(presenceRef, {
    uid:      user.uid,
    username: userData.username,
    title,
    score:    userData.totalDamageDealt || 0,
    lastSeen: serverTimestamp(),
  }, { merge: true });

  // Ping setiap 30 detik
  setInterval(async () => {
    await updateDoc(presenceRef, { lastSeen: serverTimestamp() });
  }, 30000);
}

// ─────────────────────────────────────────────────────
//  EXPORTS — expose ke file lain
// ─────────────────────────────────────────────────────
export {
  auth, db,
  doc, getDoc, setDoc, updateDoc, addDoc,
  collection, query, orderBy, onSnapshot,
  serverTimestamp, increment,
  signOut,
  requireAuth,
  saveBattleResult,
  initPresence,
  DEFAULT_USER,
};
