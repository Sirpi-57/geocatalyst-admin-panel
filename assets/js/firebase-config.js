// ===================================
// FIREBASE CONFIGURATION & INITIALIZATION
// ===================================

// Import Firebase modules (v9+ modular SDK)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCSWxF7rq6zc-qtPiFqCfI8i59g7SZkgUc",
    authDomain: "geocatalyst-production.firebaseapp.com",
    projectId: "geocatalyst-production",
    storageBucket: "geocatalyst-production.firebasestorage.app",
    messagingSenderId: "199953245511",
    appId: "1:199953245511:web:213523b76e8e5f290f5862"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);
const db = getFirestore(app);

// Export for use in other files
export { auth, db };